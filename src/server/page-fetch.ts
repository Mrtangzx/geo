import { Resolver } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import type { PageRedirect } from "@/lib/page-contracts";
import { normalizePageUrl } from "./page-validation";

export const PAGE_LIMITS = { maxPages: 10, bodyBytes: 1024 * 1024, robotsBytes: 128 * 1024, redirects: 3, totalMs: 25_000, hopMs: 8_000, dnsMs: 2_500 } as const;

interface PublicAddress { address: string; family: 4 | 6 }
export interface FetchTrace {
  finalUrl: string | null;
  httpStatus: number | null;
  headers: Record<string, string>;
  bytesRead: number | null;
  resolvedAddresses: string[];
  redirects: PageRedirect[];
}
export interface PublicPageResponse extends FetchTrace {
  finalUrl: string;
  httpStatus: number;
  bytesRead: number;
  body: Buffer;
}

export class PageFetchError extends Error {
  trace: Partial<FetchTrace> = {};
  constructor(public readonly code: string, message: string) { super(message); this.name = "PageFetchError"; }
}

export function isPublicPageAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.toString() === "168.63.129.16") return false; // Azure platform virtual service address.
    // Only ordinary globally routable unicast is accepted. This rejects mapped
    // IPv6, NAT64/6to4/Teredo, RFC1918, CGNAT, metadata/link-local and reserved IPs.
    if (parsed.range() !== "unicast") return false;
    if (parsed.kind() === "ipv6") {
      const v6 = parsed as ipaddr.IPv6;
      return !v6.zoneId && v6.parts[0] >= 0x2000 && v6.parts[0] <= 0x3fff
        && !(v6.parts[0] === 0x3fff && v6.parts[1] < 0x1000);
    }
    return true;
  } catch { return false; }
}

function hostnameOf(url: URL) { return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase(); }

function abortFailure() { return new PageFetchError("FETCH_TIMEOUT_OR_CANCELLED", "检查超时或已取消；未完成的正文保持未知。"); }

export async function resolvePublicPageTarget(url: URL, signal: AbortSignal): Promise<PublicAddress[]> {
  if (signal.aborted) throw abortFailure();
  const hostname = hostnameOf(url);
  if (isIP(hostname)) {
    if (!isPublicPageAddress(hostname)) throw new PageFetchError("UNSAFE_TARGET", "已阻止本机、内网、保留或云内部地址，未向该目标发起网页请求。");
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  if (!hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(hostname) || ["metadata", "instance-data"].includes(hostname)) {
    throw new PageFetchError("UNSAFE_HOSTNAME", "该主机名不属于可检查的公共网页目标。");
  }
  const resolver = new Resolver({ timeout: PAGE_LIMITS.dnsMs, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    if (signal.aborted) throw abortFailure();
    const addresses: PublicAddress[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        for (const address of result.value) addresses.push({ address, family: index === 0 ? 4 : 6 });
      } else {
        const code = (result.reason as NodeJS.ErrnoException)?.code;
        if (code !== "ENODATA" && code !== "ENOTFOUND") throw new PageFetchError("DNS_UNVERIFIED", "无法完整核对目标的 IPv4/IPv6 地址，已停止请求。");
      }
    }
    if (!addresses.length) throw new PageFetchError("DNS_NOT_FOUND", "未找到该公共页面的有效 DNS 地址。");
    if (addresses.length > 64 || addresses.some(({ address }) => !isPublicPageAddress(address))) {
      throw new PageFetchError("UNSAFE_DNS_ANSWER", "DNS 结果含非公共或不可确认的地址，已阻止网页请求。");
    }
    return addresses;
  } finally { signal.removeEventListener("abort", cancel); }
}

function safeHeaders(input: IncomingHttpHeaders): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of ["content-type", "content-encoding", "content-length", "x-robots-tag", "location", "last-modified", "etag", "cache-control", "date", "server"]) {
    const value = input[key];
    if (value !== undefined) output[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return output;
}

function pinnedRequest(url: URL, addresses: PublicAddress[], signal: AbortSignal, maxBytes: number): Promise<PublicPageResponse> {
  return new Promise((resolve, reject) => {
    const pinned = addresses.find((item) => item.family === 4) ?? addresses[0];
    const hostname = hostnameOf(url);
    const trace: FetchTrace = { finalUrl: url.href, httpStatus: null, headers: {}, bytesRead: 0, resolvedAddresses: addresses.map((item) => item.address), redirects: [] };
    const fail = (error: PageFetchError) => { error.trace = { ...trace, ...error.trace }; reject(error); };
    const lookup: LookupFunction = (requestedHostname, options, callback) => {
      if (requestedHostname.replace(/\.$/, "").toLowerCase() !== hostname) {
        callback(new Error("Unexpected hostname during pinned lookup"), "", 0); return;
      }
      if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)({
      protocol: url.protocol, hostname, port: url.port || undefined,
      path: `${url.pathname}${url.search}`, method: "GET", lookup,
      family: pinned.family, agent: false, signal,
      maxHeaderSize: 16 * 1024,
      headers: { Host: url.host, "User-Agent": "GEOReviewBot/0.1", Accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "Accept-Encoding": "identity", Connection: "close" },
    }, (response) => {
      trace.httpStatus = response.statusCode ?? 0;
      trace.headers = safeHeaders(response.headers);
      if ([301, 302, 303, 307, 308].includes(trace.httpStatus)) {
        resolve({ ...trace, finalUrl: url.href, httpStatus: trace.httpStatus, bytesRead: 0, body: Buffer.alloc(0) });
        response.destroy(); return;
      }
      const encoding = response.headers["content-encoding"]?.toLowerCase().trim();
      if (encoding && encoding !== "identity") {
        // No decoder is installed in this transport: compressed input is rejected,
        // so compressed-byte limits cannot be bypassed by decompression expansion.
        fail(new PageFetchError("UNSUPPORTED_CONTENT_ENCODING", "目标忽略了不压缩请求；为限制解压膨胀，本次未读取正文。"));
        response.destroy(); return;
      }
      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        fail(new PageFetchError("BODY_TOO_LARGE", "响应超过本次大小上限，正文未作为完整快照读取。"));
        response.destroy(); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        trace.bytesRead = bytes;
        if (bytes > maxBytes) {
          fail(new PageFetchError("BODY_TOO_LARGE", "响应超过本次大小上限，已停止读取，正文保持未知。"));
          response.destroy(); return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        if (!response.complete) { fail(new PageFetchError("INCOMPLETE_RESPONSE", "响应未完整接收，不能当作完整正文。")); return; }
        resolve({ ...trace, finalUrl: url.href, httpStatus: trace.httpStatus!, bytesRead: bytes, body: Buffer.concat(chunks, bytes) });
      });
      response.once("error", () => fail(signal.aborted ? abortFailure() : new PageFetchError("RESPONSE_INTERRUPTED", "页面响应读取中断，正文保持未知。")));
      response.once("aborted", () => fail(signal.aborted ? abortFailure() : new PageFetchError("RESPONSE_INTERRUPTED", "页面响应未完整返回，正文保持未知。")));
    });
    request.maxHeadersCount = 100;
    request.setTimeout(PAGE_LIMITS.hopMs, () => request.destroy(new PageFetchError("HOP_TIMEOUT", "页面连接或读取超时，正文保持未知。")));
    request.once("socket", (socket) => socket.once("connect", () => {
      try {
        const remote = socket.remoteAddress;
        if (!remote || ipaddr.process(remote).toNormalizedString() !== ipaddr.process(pinned.address).toNormalizedString()) {
          request.destroy(new PageFetchError("REMOTE_ADDRESS_MISMATCH", "实际连接地址与已校验地址不匹配，已中止连接。"));
        }
      } catch { request.destroy(new PageFetchError("REMOTE_ADDRESS_MISMATCH", "实际连接地址无法确认，已中止连接。")); }
    }));
    request.once("error", (error) => fail(error instanceof PageFetchError ? error : signal.aborted ? abortFailure() : new PageFetchError("PAGE_CONNECTION_FAILED", "无法建立或完成公共页面连接；请核对目标是否可访问。")));
    request.end();
  });
}

export async function fetchPublicPage(input: string, signal: AbortSignal, maxBytes: number = PAGE_LIMITS.bodyBytes): Promise<PublicPageResponse> {
  let current = input;
  const redirects: PageRedirect[] = [];
  const visited = new Set<string>();
  try {
    for (let hop = 0; hop <= PAGE_LIMITS.redirects; hop += 1) {
      if (signal.aborted) throw abortFailure();
      let url: URL;
      try { url = normalizePageUrl(current); } catch (error) { throw new PageFetchError("UNSAFE_REDIRECT_OR_URL", error instanceof Error ? error.message : "页面目标不安全。"); }
      if (visited.has(url.href)) throw new PageFetchError("REDIRECT_LOOP", "页面出现循环重定向，已停止检查。");
      visited.add(url.href);
      const addresses = await resolvePublicPageTarget(url, signal);
      const response = await pinnedRequest(url, addresses, signal, maxBytes);
      if (![301, 302, 303, 307, 308].includes(response.httpStatus)) return { ...response, redirects };
      const location = response.headers.location;
      if (!location) throw new PageFetchError("REDIRECT_WITHOUT_LOCATION", "页面返回重定向但没有目标地址。");
      redirects.push({ url: url.href, status: response.httpStatus, location, resolvedAddresses: response.resolvedAddresses });
      if (hop === PAGE_LIMITS.redirects) throw new PageFetchError("TOO_MANY_REDIRECTS", "页面重定向超过 3 跳上限，已停止检查。");
      try { current = new URL(location, url).href; } catch { throw new PageFetchError("INVALID_REDIRECT", "页面返回了无法读取的重定向地址。"); }
    }
    throw new PageFetchError("TOO_MANY_REDIRECTS", "页面重定向超过限制。");
  } catch (error) {
    const failure = error instanceof PageFetchError ? error : new PageFetchError("PAGE_FETCH_FAILED", "页面检查未完成，正文保持未知。");
    failure.trace = { finalUrl: current, redirects, ...failure.trace };
    throw failure;
  }
}
