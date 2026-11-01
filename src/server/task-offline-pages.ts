import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import type { TaskPageSnapshot } from "@/lib/task-contracts";
import { AppError } from "./errors";
import { inspectRobots } from "./page-diagnostics";
import { getProject } from "./projects";
import { getPageCollection, savePageCollection } from "./page-repository";

interface FixtureSnapshot { snapshot_id: string; body_path: string; http_status: number; headers: Record<string, string>; captured_at: string; site_version: string; is_synthetic: boolean }
interface FixtureManifest { is_synthetic: boolean; pages: { page_id: string; url: string; snapshots: FixtureSnapshot[] }[]; robots: { url: string; before: { body_path: string; http_status: number }; after: { body_path: string; http_status: number } } }
const fixtureRoot = path.resolve(process.cwd(), "test-materials/geo-r2");

async function fixtureFile(relative: string): Promise<string> {
  const root = await realpath(fixtureRoot);
  const resolved = await realpath(path.resolve(root, relative));
  if (!resolved.startsWith(root + path.sep) || !/\.(?:html|txt|json)$/.test(resolved) || (await stat(resolved)).size > 1024 * 1024) throw new AppError(400, "INVALID_FIXTURE_PATH", "合成页面不在固定资料清单内。");
  return readFile(resolved, "utf8");
}
async function manifest(): Promise<FixtureManifest> {
  const data = JSON.parse(await fixtureFile("inputs/pages.json")) as FixtureManifest;
  if (data.is_synthetic !== true) throw new AppError(409, "FIXTURE_NOT_SYNTHETIC", "合成页面清单标记无效。");
  return data;
}
export async function listFixtureTaskSnapshots() {
  const data = await manifest();
  return data.pages.flatMap((page) => page.snapshots.map((snapshot) => ({ id: snapshot.snapshot_id, url: page.url, observedAt: snapshot.captured_at })));
}

export async function ensureFixturePageSelection(workspaceId: string, projectId: string) {
  const project = await getProject(workspaceId, projectId);
  if (!project.isSynthetic) throw new AppError(409, "SYNTHETIC_PROJECT_REQUIRED", "固定页面回放仅用于合成项目。");
  const current = await getPageCollection(workspaceId, projectId);
  if (current.collection.version || current.collection.pages.length) return current.collection;
  const data = await manifest();
  return savePageCollection(workspaceId, projectId, { expectedVersion: 0, pages: data.pages.filter((page) => ["P-HOME", "P-PRODUCT", "P-ACCESS"].includes(page.page_id)).map((page) => ({ url: page.url, label: `合成 ${page.page_id}` })) });
}

export async function replayTaskPage(snapshotId: string, targetUrl: string): Promise<TaskPageSnapshot> {
  const data = await manifest();
  const page = data.pages.find((entry) => entry.url === targetUrl);
  const snapshot = page?.snapshots.find((entry) => entry.snapshot_id === snapshotId);
  if (!page || !snapshot || !snapshot.is_synthetic) throw new AppError(400, "FIXTURE_PAGE_NOT_FOUND", "该快照不属于目标页面的固定合成清单。");
  const rawBody = await fixtureFile(snapshot.body_path);
  const $ = load(rawBody);
  const noindex = /(?:^|[\s,])(?:noindex|none)(?:[\s,]|$)/i.test(snapshot.headers["X-Robots-Tag"] ?? "") || $("meta[name='robots']").toArray().some((element) => /(?:^|[\s,])(?:noindex|none)(?:[\s,]|$)/i.test($(element).attr("content") ?? ""));
  $("script,style,noscript,template,svg,canvas,iframe,object,embed").remove();
  $("p,div,section,article,h1,h2,h3,li,br").append("\n");
  const text = ($("main").length ? $("main").first() : $("body")).text().replace(/[ \t]+/g, " ").replace(/\n[ \t]*/g, "\n").trim();
  const robotsFixture = snapshot.snapshot_id.endsWith("before") ? data.robots.before : data.robots.after;
  const robotsBody = await fixtureFile(robotsFixture.body_path);
  const matchingRobots = new URL(page.url).origin === new URL(data.robots.url).origin;
  return {
    id: snapshotId, url: page.url, source: "synthetic_fixture", isSynthetic: true,
    executedAt: new Date().toISOString(), observedAt: snapshot.captured_at, httpStatus: snapshot.http_status,
    bodyComplete: true, text, rawBody, bodySha256: createHash("sha256").update(rawBody).digest("hex"),
    noindex, robotsAllows: matchingRobots ? inspectRobots(robotsBody, page.url).crawlerAccess === "allowed" : null,
    error: snapshot.http_status === 200 ? null : "合成快照记录的HTTP状态未通过。",
  };
}
