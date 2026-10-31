import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { PageCaptureResult, RobotsGroup, RobotsObservation } from "@/lib/page-contracts";
import { fetchPublicPage, PAGE_LIMITS, PageFetchError } from "./page-fetch";

export function emptyPageCapture(url: string, checkedAt = new Date().toISOString()): PageCaptureResult {
  return {
    requestedUrl: url, finalUrl: null, checkedAt, completedAt: null, status: "running",
    httpStatus: null, headers: {}, contentType: null, charset: null, bodyComplete: false,
    bodyReadable: "unknown", title: null, text: null, rawBody: null, bodySha256: null,
    bytesRead: null, resolvedAddresses: [], redirects: [],
    indexControl: { meta: [], xRobotsTag: null, generalNoindex: null },
    robots: { url: new URL("/robots.txt", url).href, finalUrl: null, checkedAt: null, status: "unknown", httpStatus: null, body: null, groups: [], crawlerAccess: "unknown", crawlerAgent: "GEOReviewBot", reason: null },
    observations: [], error: null,
  };
}

function normalizeRobotsPath(path: string) {
  return encodeURI(path).replace(/%25([a-f\d]{2})/gi, "%$1").replace(/%[a-f\d]{2}/gi, (encoded) => {
    const char = String.fromCharCode(parseInt(encoded.slice(1), 16));
    return /[a-z\d._~-]/i.test(char) ? char : encoded.toUpperCase();
  });
}

function matchesRobotsPath(pattern: string, target: string, endAnchored: boolean) {
  // Ordered literal segments avoid executing an attacker-controlled regex.
  // A long robots rule containing many wildcards cannot cause regex backtracking.
  if (!pattern.includes("*")) return endAnchored ? target === pattern : target.startsWith(pattern);
  const parts = pattern.split("*").filter(Boolean);
  let position = 0;
  if (!pattern.startsWith("*")) {
    const first = parts.shift() ?? "";
    if (!target.startsWith(first)) return false;
    position = first.length;
  }
  const suffix = endAnchored && !pattern.endsWith("*") ? parts.pop() : undefined;
  for (const part of parts) {
    const index = target.indexOf(part, position);
    if (index < 0) return false;
    position = index + part.length;
  }
  return suffix === undefined || (target.endsWith(suffix) && target.length - suffix.length >= position);
}

export function inspectRobots(body: string, url: string): { groups: RobotsGroup[]; crawlerAccess: "allowed" | "disallowed" | "unknown"; reason: string } {
  if (/^\s*</.test(body)) return { groups: [], crawlerAccess: "unknown", reason: "robots.txt 返回了标记文档，无法确认其规则。" };
  const groups: RobotsGroup[] = [];
  let group: RobotsGroup | null = null;
  for (const raw of body.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.split("#", 1)[0].trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      if (value) group.agents.push(value.toLowerCase());
    } else if (group && (field === "allow" || field === "disallow")) {
      group.rules.push({ directive: field, path: value });
    }
  }
  const agent = "georeviewbot";
  const ranked = groups.map((candidate) => ({ group: candidate, rank: Math.max(-1, ...candidate.agents.map((item) => item === "*" ? 0 : agent.includes(item) ? item.length : -1)) }));
  const maxRank = Math.max(-1, ...ranked.map((item) => item.rank));
  if (maxRank < 0) return { groups, crawlerAccess: "allowed", reason: "未观察到适用于 GEOReviewBot 的限制规则；不代表其他 AI 平台获准抓取或已收录。" };
  const parsed = new URL(url);
  const targetPath = normalizeRobotsPath(`${parsed.pathname}${parsed.search}`);
  const matches: { directive: "allow" | "disallow"; specificity: number }[] = [];
  for (const { group: candidate, rank } of ranked) {
    if (rank !== maxRank) continue;
    for (const rule of candidate.rules) {
      if (!rule.path) continue;
      const normalized = normalizeRobotsPath(rule.path);
      const endAnchored = normalized.endsWith("$");
      const pattern = endAnchored ? normalized.slice(0, -1) : normalized;
      if (matchesRobotsPath(pattern, targetPath, endAnchored)) matches.push({ directive: rule.directive, specificity: pattern.replace(/%[a-f\d]{2}/gi, "x").replace(/\*/g, "").length });
    }
  }
  matches.sort((left, right) => right.specificity - left.specificity || (left.directive === "allow" ? -1 : 1));
  const blocked = matches[0]?.directive === "disallow";
  return { groups, crawlerAccess: blocked ? "disallowed" : "allowed", reason: blocked ? "robots.txt 中适用于 GEOReviewBot 的最长匹配规则为 Disallow，本次未读取业务页面。" : "未观察到阻止 GEOReviewBot 读取该路径的匹配规则；不代表 AI 已抓取或收录。" };
}

function decodeBody(bytes: Buffer, contentType: string | undefined): { body: string; charset: string } {
  const headerCharset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType ?? "")?.[1];
  const preamble = bytes.subarray(0, 4096).toString("ascii");
  const htmlCharset = /<meta[^>]*charset\s*=\s*["']?([^\s"'/>;]+)/i.exec(preamble)?.[1];
  const charset = headerCharset || htmlCharset || "utf-8";
  try { return { body: new TextDecoder(charset, { fatal: true }).decode(bytes), charset }; }
  catch { throw new PageFetchError("BODY_DECODING_FAILED", "正文编码无法可靠读取，保留未知状态，不当作空正文。"); }
}

async function captureRobots(url: string, signal: AbortSignal): Promise<RobotsObservation> {
  const robotsUrl = new URL("/robots.txt", url).href;
  const result: RobotsObservation = { url: robotsUrl, finalUrl: null, checkedAt: new Date().toISOString(), status: "unknown", httpStatus: null, body: null, groups: [], crawlerAccess: "unknown", crawlerAgent: "GEOReviewBot", reason: null };
  try {
    const response = await fetchPublicPage(robotsUrl, AbortSignal.any([signal, AbortSignal.timeout(8_000)]), PAGE_LIMITS.robotsBytes);
    result.finalUrl = response.finalUrl;
    result.httpStatus = response.httpStatus;
    if ([404, 410].includes(response.httpStatus)) {
      result.status = "not_found"; result.crawlerAccess = "allowed"; result.reason = "未找到 robots.txt；本结果不证明任何目标 AI 平台已抓取或收录。"; return result;
    }
    if (response.httpStatus < 200 || response.httpStatus >= 300) {
      result.status = "unavailable"; result.reason = `robots.txt 返回 HTTP ${response.httpStatus}，规则未知。`; return result;
    }
    result.body = decodeBody(response.body, response.headers["content-type"]).body;
    const parsed = inspectRobots(result.body, url);
    Object.assign(result, parsed);
    result.status = parsed.crawlerAccess === "unknown" ? "unknown" : "available";
    return result;
  } catch (error) {
    const failure = error instanceof PageFetchError ? error : new PageFetchError("ROBOTS_FAILED", "robots.txt 读取未完成，规则未知。");
    result.status = /UNSAFE|MISMATCH/.test(failure.code) ? "blocked" : "unavailable";
    result.httpStatus = failure.trace.httpStatus ?? null;
    result.finalUrl = failure.trace.finalUrl ?? null;
    result.reason = failure.message;
    return result;
  }
}

function generalHeaderNoindex(value: string | undefined): boolean {
  let scoped = false;
  for (const part of (value ?? "").toLowerCase().split(",")) {
    const scope = /^\s*([a-z\d*_-]+)\s*:\s*(.*)$/.exec(part);
    if (scope) scoped = scope[1] !== "*";
    const directive = scope ? scope[2] : part;
    if (!scoped && /(?:^|\s)(?:noindex|none)(?:\s|$)/.test(directive.trim())) return true;
  }
  return false;
}

export async function capturePublicPage(url: string, externalSignal?: AbortSignal): Promise<PageCaptureResult> {
  const result = emptyPageCapture(url);
  const signal = AbortSignal.any([AbortSignal.timeout(PAGE_LIMITS.totalMs), ...(externalSignal ? [externalSignal] : [])]);
  let response: Awaited<ReturnType<typeof fetchPublicPage>> | undefined;
  try {
    // robots uses the same pinned/public-only transport; a disallow for this
    // crawler is observed and respected instead of fetching the business page.
    result.robots = await captureRobots(url, signal);
    if (result.robots.crawlerAccess === "disallowed") {
      result.status = "blocked";
      result.error = { code: "ROBOTS_DISALLOWED", message: result.robots.reason! };
      result.observations.push(result.robots.reason!);
      return result;
    }
    response = await fetchPublicPage(url, signal);
    result.finalUrl = response.finalUrl;
    result.httpStatus = response.httpStatus;
    result.headers = response.headers;
    result.bytesRead = response.bytesRead;
    result.resolvedAddresses = response.resolvedAddresses;
    result.redirects = response.redirects;
    result.contentType = response.headers["content-type"] ?? null;
    result.bodyComplete = true;
    result.bodySha256 = createHash("sha256").update(response.body).digest("hex");
    result.indexControl.xRobotsTag = response.headers["x-robots-tag"] ?? null;
    const headerNoindex = generalHeaderNoindex(response.headers["x-robots-tag"]);
    result.indexControl.generalNoindex = headerNoindex ? true : null;
    result.status = response.httpStatus >= 200 && response.httpStatus < 300 ? "success" : "http_error";
    if (result.status === "http_error") result.observations.push(`页面返回 HTTP ${response.httpStatus}，未确认业务页面可正常访问。`);
    const mime = (result.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!["text/html", "application/xhtml+xml", "text/plain"].includes(mime)) {
      result.bodyReadable = "unsupported";
      result.observations.push("该响应类型不支持正文提取，正文可读性未知。");
      return result;
    }
    const decoded = decodeBody(response.body, result.contentType ?? undefined);
    result.rawBody = decoded.body;
    result.charset = decoded.charset;
    if (mime === "text/plain") {
      result.text = decoded.body.trim();
    } else {
      const $ = load(decoded.body);
      result.title = $("title").first().text().trim() || null;
      $("meta[name]").each((_, element) => {
        const name = ($(element).attr("name") ?? "").toLowerCase();
        if (name === "robots" || name.includes("bot")) result.indexControl.meta.push({ agent: name, content: $(element).attr("content") ?? "" });
      });
      result.indexControl.generalNoindex = headerNoindex || result.indexControl.meta.some((item) => item.agent === "robots" && /(?:^|[\s,])(?:noindex|none)(?:[\s,]|$)/i.test(item.content));
      $("script,style,noscript,template,svg,canvas,iframe,object,embed").remove();
      const main = $("main").first();
      const article = $("article").first();
      const content = main.length ? main : article.length ? article : $("body");
      content.find("br").replaceWith("\n");
      content.find("p,div,section,article,h1,h2,h3,h4,h5,h6,li,tr,pre").append("\n");
      result.text = content.text().replace(/[ \t\f\v]+/g, " ").replace(/\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    result.bodyReadable = result.text.length ? "readable" : "empty";
    if (result.bodyReadable === "empty") result.observations.push("响应中未提取到可读正文；不能推定目标平台可读取业务内容。");
    else if (result.text.length < 80) result.observations.push("提取正文少于 80 字符，请人工核对是否为目标业务内容。");
    if (result.indexControl.generalNoindex) result.observations.push("观察到通用 noindex 或 none 指令；这是索引控制信号，不证明 AI 平台的实际收录状态。");
    if (result.indexControl.meta.some((item) => item.agent !== "robots")) result.observations.push("页面含特定机器人指令，需按其作用对象人工核对。");
    if (result.robots.crawlerAccess === "unknown") result.observations.push("robots.txt 未完整核对，访问规则保持未知。");
    return result;
  } catch (error) {
    const failure = error instanceof PageFetchError ? error : new PageFetchError("BODY_INSPECTION_FAILED", "页面正文处理未完成，内容可读性保持未知。");
    if (!response) {
      result.finalUrl = failure.trace.finalUrl ?? null;
      result.httpStatus = failure.trace.httpStatus ?? null;
      result.headers = failure.trace.headers ?? {};
      result.contentType = result.headers["content-type"] ?? null;
      result.bytesRead = failure.trace.bytesRead ?? null;
      result.resolvedAddresses = failure.trace.resolvedAddresses ?? [];
      result.redirects = failure.trace.redirects ?? [];
    }
    result.status = /UNSAFE|MISMATCH/.test(failure.code) ? "blocked" : "failed";
    result.bodyReadable = "unknown";
    result.error = { code: failure.code, message: failure.message };
    result.observations.push(failure.message);
    return result;
  } finally { result.completedAt = new Date().toISOString(); }
}
