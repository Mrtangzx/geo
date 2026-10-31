import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { projects } from "@/db/schema";
import { pageCollections, pageCollectionVersions, pageSnapshots } from "@/db/page-schema";
import type { PageCollection, PageCollectionInput, PageCollectionResponse, PageSnapshot, PageSnapshotSummary } from "@/lib/page-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { capturePublicPage, emptyPageCapture } from "./page-diagnostics";

function summarize(snapshot: PageSnapshot): PageSnapshotSummary {
  const { rawBody: _rawBody, text: _text, robots, indexControl, ...summary } = snapshot;
  const { body: _body, groups: _groups, ...robotsSummary } = robots;
  const { meta: _meta, ...indexSummary } = indexControl;
  void _rawBody; void _text; void _body; void _groups; void _meta;
  return { ...summary, robots: robotsSummary, indexControl: indexSummary };
}

function collectionMissing(projectId: string, workspaceId: string): PageCollection {
  return { projectId, workspaceId, version: 0, pages: [], updatedAt: new Date().toISOString() };
}

export async function getPageCollection(workspaceId: string, projectId: string): Promise<PageCollectionResponse> {
  await getProject(workspaceId, projectId);
  const db = getDatabase();
  const [collection] = await db.select().from(pageCollections).where(and(eq(pageCollections.projectId, projectId), eq(pageCollections.workspaceId, workspaceId))).limit(1);
  if (!collection) return { collection: collectionMissing(projectId, workspaceId), latestSnapshots: [] };
  if (!collection.snapshot.pages.length) return { collection: collection.snapshot, latestSnapshots: [] };
  const latest = await db.selectDistinctOn([pageSnapshots.pageId], { snapshot: pageSnapshots.snapshot }).from(pageSnapshots)
    .where(and(eq(pageSnapshots.workspaceId, workspaceId), eq(pageSnapshots.projectId, projectId), inArray(pageSnapshots.pageId, collection.snapshot.pages.map((page) => page.id))))
    .orderBy(pageSnapshots.pageId, desc(pageSnapshots.revision));
  return {
    collection: collection.snapshot,
    latestSnapshots: latest
      .filter((row) => collection.snapshot.pages.some((page) => page.id === row.snapshot.pageId && page.url === row.snapshot.requestedUrl))
      .map((row) => summarize(row.snapshot)),
  };
}

export async function savePageCollection(workspaceId: string, projectId: string, input: PageCollectionInput): Promise<PageCollection> {
  return getDatabase().transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "未找到该品牌项目。");
    const [previous] = await tx.select().from(pageCollections).where(and(eq(pageCollections.projectId, projectId), eq(pageCollections.workspaceId, workspaceId))).for("update");
    if ((previous?.version ?? 0) !== input.expectedVersion) throw new AppError(409, "PAGE_COLLECTION_CONFLICT", "页面选择已被更新，请重新读取后再保存。");
    if (previous?.checkToken && previous.checkExpiresAt && previous.checkExpiresAt > new Date()) throw new AppError(409, "PAGE_CHECK_RUNNING", "当前项目正在检查页面，请完成后再调整页面选择。");
    const now = new Date();
    const oldPages = new Map(previous?.snapshot.pages.map((page) => [page.id, page]) ?? []);
    const snapshot: PageCollection = {
      projectId, workspaceId, version: input.expectedVersion + 1, updatedAt: now.toISOString(),
      pages: input.pages.map((page) => {
        if (page.id && !oldPages.has(page.id)) throw new AppError(400, "PAGE_NOT_FOUND", "页面标识不属于当前页面选择，请重新读取。");
        return { id: page.id ?? randomUUID(), url: page.url, label: page.label };
      }),
    };
    await tx.insert(pageCollections).values({ projectId, workspaceId, version: snapshot.version, snapshot, updatedAt: now })
      .onConflictDoUpdate({ target: pageCollections.projectId, set: { version: snapshot.version, snapshot, updatedAt: now } });
    await tx.insert(pageCollectionVersions).values({ projectId, workspaceId, version: snapshot.version, snapshot, createdAt: now });
    return snapshot;
  });
}

export async function listPageCollectionVersions(workspaceId: string, projectId: string): Promise<PageCollection[]> {
  await getProject(workspaceId, projectId);
  const rows = await getDatabase().select({ snapshot: pageCollectionVersions.snapshot }).from(pageCollectionVersions)
    .where(and(eq(pageCollectionVersions.workspaceId, workspaceId), eq(pageCollectionVersions.projectId, projectId)))
    .orderBy(desc(pageCollectionVersions.version)).limit(100);
  return rows.map((row) => row.snapshot);
}

async function beginPageCheck(workspaceId: string, actorId: string, projectId: string, pageId: string): Promise<PageSnapshot> {
  return getDatabase().transaction(async (tx) => {
    const [project] = await tx.select({ version: projects.version }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "未找到该品牌项目。");
    const [collection] = await tx.select().from(pageCollections).where(and(eq(pageCollections.projectId, projectId), eq(pageCollections.workspaceId, workspaceId))).for("update");
    const selected = collection?.snapshot.pages.find((page) => page.id === pageId);
    if (!collection || !selected) throw new AppError(404, "PAGE_NOT_SELECTED", "该页面不在当前项目的页面选择中。");
    const now = new Date();
    if (collection.checkToken && collection.checkExpiresAt && collection.checkExpiresAt > now) throw new AppError(409, "PAGE_CHECK_RUNNING", "当前项目已有页面检查正在进行，请稍后重试。");
    if (collection.checkToken) {
      const [unfinished] = await tx.select().from(pageSnapshots).where(and(eq(pageSnapshots.id, collection.checkToken), eq(pageSnapshots.workspaceId, workspaceId), eq(pageSnapshots.projectId, projectId), eq(pageSnapshots.status, "running"))).limit(1);
      if (unfinished) {
        const interrupted: PageSnapshot = { ...unfinished.snapshot, status: "failed", completedAt: now.toISOString(), error: { code: "CHECK_INTERRUPTED", message: "上次检查未在有效期内完成；保留未知结果，可发起新的检查。" } };
        await tx.update(pageSnapshots).set({ status: "failed", snapshot: interrupted }).where(and(eq(pageSnapshots.id, unfinished.id), eq(pageSnapshots.status, "running")));
      }
    }
    const [{ highest }] = await tx.select({ highest: max(pageSnapshots.revision) }).from(pageSnapshots).where(and(eq(pageSnapshots.workspaceId, workspaceId), eq(pageSnapshots.projectId, projectId), eq(pageSnapshots.pageId, pageId)));
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + 45_000);
    const snapshot: PageSnapshot = {
      ...emptyPageCapture(selected.url, now.toISOString()), id, projectId, workspaceId, pageId,
      label: selected.label, revision: (highest ?? 0) + 1, collectionVersion: collection.version,
      projectVersion: project.version, actorId, leaseExpiresAt: expiresAt.toISOString(),
    };
    await tx.insert(pageSnapshots).values({ id, projectId, workspaceId, pageId, revision: snapshot.revision, status: "running", snapshot, createdAt: now });
    await tx.update(pageCollections).set({ checkToken: id, checkExpiresAt: expiresAt }).where(and(eq(pageCollections.projectId, projectId), eq(pageCollections.workspaceId, workspaceId)));
    return snapshot;
  });
}

export async function checkSelectedPage(workspaceId: string, actorId: string, projectId: string, pageId: string, signal?: AbortSignal): Promise<PageSnapshot> {
  const started = await beginPageCheck(workspaceId, actorId, projectId, pageId);
  // The network operation holds neither a database transaction nor a pooled
  // connection. A short database lease prevents duplicate concurrent checks.
  const result = await capturePublicPage(started.requestedUrl, signal);
  return getDatabase().transaction(async (tx) => {
    const completed: PageSnapshot = { ...started, ...result, checkedAt: started.checkedAt };
    const rows = await tx.update(pageSnapshots).set({ status: completed.status, snapshot: completed })
      .where(and(eq(pageSnapshots.id, started.id), eq(pageSnapshots.workspaceId, workspaceId), eq(pageSnapshots.projectId, projectId), eq(pageSnapshots.status, "running")))
      .returning({ snapshot: pageSnapshots.snapshot });
    await tx.update(pageCollections).set({ checkToken: null, checkExpiresAt: null })
      .where(and(eq(pageCollections.projectId, projectId), eq(pageCollections.workspaceId, workspaceId), eq(pageCollections.checkToken, started.id)));
    if (rows[0]) return rows[0].snapshot;
    const [existing] = await tx.select({ snapshot: pageSnapshots.snapshot }).from(pageSnapshots).where(and(eq(pageSnapshots.id, started.id), eq(pageSnapshots.workspaceId, workspaceId), eq(pageSnapshots.projectId, projectId))).limit(1);
    if (!existing) throw new AppError(404, "PAGE_SNAPSHOT_NOT_FOUND", "未找到本次检查记录。");
    return existing.snapshot;
  });
}

export async function listPageSnapshots(workspaceId: string, projectId: string, pageId: string): Promise<PageSnapshotSummary[]> {
  await getProject(workspaceId, projectId);
  const rows = await getDatabase().select({ snapshot: pageSnapshots.snapshot }).from(pageSnapshots)
    .where(and(eq(pageSnapshots.workspaceId, workspaceId), eq(pageSnapshots.projectId, projectId), eq(pageSnapshots.pageId, pageId)))
    .orderBy(desc(pageSnapshots.revision)).limit(100);
  return rows.map((row) => summarize(row.snapshot));
}

export async function getPageSnapshot(workspaceId: string, projectId: string, pageId: string, snapshotId: string): Promise<PageSnapshot> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: pageSnapshots.snapshot }).from(pageSnapshots)
    .where(and(eq(pageSnapshots.id, snapshotId), eq(pageSnapshots.workspaceId, workspaceId), eq(pageSnapshots.projectId, projectId), eq(pageSnapshots.pageId, pageId))).limit(1);
  if (!row) throw new AppError(404, "PAGE_SNAPSHOT_NOT_FOUND", "未找到该页面快照。");
  return row.snapshot;
}
