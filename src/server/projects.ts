import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { projects, projectVersions, workspaces } from "@/db/schema";
import type { Project, ProjectFact, ProjectInput, ProjectVersion } from "@/lib/contracts";
import { AppError } from "./errors";

function missingProject(): never {
  throw new AppError(404, "PROJECT_NOT_FOUND", "未找到该品牌项目。");
}

function resolveFacts(input: ProjectInput, actorId: string, now: string, previous?: Project): ProjectFact[] {
  const previousFacts = new Map(previous?.facts.map((fact) => [fact.id, fact]) ?? []);
  return input.facts.map((fact) => {
    const old = fact.id ? previousFacts.get(fact.id) : undefined;
    if (previous && fact.id && !old) {
      throw new AppError(400, "FACT_NOT_FOUND", "事实版本已变化，请重新打开项目后再编辑。");
    }
    const confirmationUnchanged = old?.status === "confirmed" && fact.status === "confirmed"
      && old.statement === fact.statement && old.sourceUrl === fact.sourceUrl && (old.sourceRef ?? "") === (fact.sourceRef ?? "");
    return {
      ...fact,
      id: old?.id ?? randomUUID(),
      confirmedBy: fact.status === "confirmed" ? (confirmationUnchanged ? old.confirmedBy : actorId) : null,
      confirmedAt: fact.status === "confirmed" ? (confirmationUnchanged ? old.confirmedAt : now) : null,
    };
  });
}

export async function listProjects(workspaceId: string): Promise<Project[]> {
  const rows = await getDatabase().select({ snapshot: projects.snapshot }).from(projects)
    .where(eq(projects.workspaceId, workspaceId)).orderBy(desc(projects.updatedAt), projects.id);
  return rows.map((row) => row.snapshot);
}

export async function getProject(workspaceId: string, projectId: string): Promise<Project> {
  const [row] = await getDatabase().select({ snapshot: projects.snapshot }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
  return row?.snapshot ?? missingProject();
}

export async function createProject(workspaceId: string, actorId: string, input: ProjectInput): Promise<Project> {
  const now = new Date();
  const project: Project = {
    ...input,
    id: randomUUID(),
    workspaceId,
    version: 1,
    facts: resolveFacts(input, actorId, now.toISOString()),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await getDatabase().transaction(async (tx) => {
    await tx.insert(workspaces).values({ id: workspaceId, name: "本地工作区" }).onConflictDoNothing();
    await tx.insert(projects).values({
      id: project.id, workspaceId, name: project.name, version: 1,
      snapshot: project, createdAt: now, updatedAt: now,
    });
    await tx.insert(projectVersions).values({ projectId: project.id, workspaceId, version: 1, snapshot: project, createdAt: now });
  });
  return project;
}

export async function updateProject(
  workspaceId: string,
  actorId: string,
  projectId: string,
  expectedVersion: number,
  input: ProjectInput,
): Promise<Project> {
  return getDatabase().transaction(async (tx) => {
    const [existing] = await tx.select({ snapshot: projects.snapshot, version: projects.version }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
    if (!existing) return missingProject();
    if (existing.version !== expectedVersion) {
      throw new AppError(409, "VERSION_CONFLICT", "项目已被更新，请重新打开最新版本后再保存。");
    }
    const now = new Date();
    const version = expectedVersion + 1;
    const project: Project = {
      ...input,
      id: projectId,
      workspaceId,
      version,
      facts: resolveFacts(input, actorId, now.toISOString(), existing.snapshot),
      createdAt: existing.snapshot.createdAt,
      updatedAt: now.toISOString(),
    };
    const updated = await tx.update(projects).set({ name: project.name, version, snapshot: project, updatedAt: now })
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), eq(projects.version, expectedVersion)))
      .returning({ id: projects.id });
    if (!updated.length) {
      throw new AppError(409, "VERSION_CONFLICT", "项目已被更新，请重新打开最新版本后再保存。");
    }
    // Each edit appends a complete snapshot. No update/delete path exists for history.
    await tx.insert(projectVersions).values({ projectId, workspaceId, version, snapshot: project, createdAt: now });
    return project;
  });
}

export async function listProjectVersions(workspaceId: string, projectId: string): Promise<ProjectVersion[]> {
  await getProject(workspaceId, projectId);
  const rows = await getDatabase().select().from(projectVersions)
    .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.workspaceId, workspaceId)))
    .orderBy(desc(projectVersions.version));
  return rows.map((row) => ({ version: row.version, createdAt: row.createdAt.toISOString(), snapshot: row.snapshot }));
}
