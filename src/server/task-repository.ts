import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDatabase } from "@/db/client";
import { modificationTasks, modificationTaskEvents } from "@/db/task-schema";
import { projects } from "@/db/schema";
import type { ModificationTask, TaskRelease, TaskVerification } from "@/lib/task-contracts";
import { getProject } from "./projects";
import { AppError } from "./errors";
import { generateTaskDrafts } from "./task-drafts";
import { listActionableDiagnoses } from "./analysis-repository";
import { prepareTaskVerification, validateTaskApproval } from "./task-verification";
import { taskActionSchema, taskDraftSchema } from "./task-validation";

function notFound(): never { throw new AppError(404, "TASK_NOT_FOUND", "未找到该工作区的修改任务。"); }

export async function listTasks(workspaceId: string, projectId: string): Promise<ModificationTask[]> {
  const project = await getProject(workspaceId, projectId);
  const rows = await getDatabase().select({ snapshot: modificationTasks.snapshot }).from(modificationTasks).where(and(eq(modificationTasks.workspaceId, workspaceId), eq(modificationTasks.projectId, projectId))).orderBy(desc(modificationTasks.createdAt), modificationTasks.id);
  const diagnoses = rows.length ? await listActionableDiagnoses(workspaceId, projectId) : [];
  const activeAnalyses = new Set(diagnoses.map((entry) => entry.analysisId));
  return rows.map(({ snapshot }) => {
    const task = structuredClone(snapshot);
    task.basisStale = task.basis.projectVersion !== project.version || task.basis.analysisIds.some((id) => !activeAnalyses.has(id));
    if (task.basisStale) {
      task.currentApprovalId = null;
      if (task.state !== "cancelled") task.state = "needs_material";
      task.releases.forEach((release) => { release.superseded = true; });
    }
    return task;
  });
}
export async function getTask(workspaceId: string, projectId: string, taskId: string): Promise<ModificationTask> {
  return (await listTasks(workspaceId, projectId)).find((task) => task.id === taskId) ?? notFound();
}
export async function listTaskReleases(workspaceId: string, projectId: string): Promise<TaskRelease[]> {
  return (await listTasks(workspaceId, projectId)).flatMap((task) => task.releases.map((release) => {
    const latest = task.verifications.find((verification) => verification.id === release.latestVerificationId);
    return { ...release, superseded: release.superseded || Boolean(latest && !latest.allPassed) };
  }));
}
export async function listTaskEvents(workspaceId: string, projectId: string, taskId: string) {
  await getTask(workspaceId, projectId, taskId);
  return getDatabase().select({ revision: modificationTaskEvents.revision, action: modificationTaskEvents.action, actorId: modificationTaskEvents.actorId, createdAt: modificationTaskEvents.createdAt, snapshot: modificationTaskEvents.snapshot }).from(modificationTaskEvents).where(and(eq(modificationTaskEvents.workspaceId, workspaceId), eq(modificationTaskEvents.taskId, taskId))).orderBy(desc(modificationTaskEvents.revision));
}

export async function generateProjectTasks(workspaceId: string, projectId: string, actorId: string) {
  const drafts = await generateTaskDrafts(workspaceId, projectId, actorId);
  const current = await listTasks(workspaceId, projectId);
  await getDatabase().transaction(async (tx) => {
    const [project] = await tx.select({ version: projects.version }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    if (!project || drafts.some((task) => task.basis.projectVersion !== project.version)) throw new AppError(409, "TASK_BASIS_CHANGED", "资料在生成过程中已变化，请重新分析后生成。");
    const existing = await tx.select({ snapshot: modificationTasks.snapshot }).from(modificationTasks).where(and(eq(modificationTasks.workspaceId, workspaceId), eq(modificationTasks.projectId, projectId)));
    for (const task of drafts) {
      const same = existing.find((row) => row.snapshot.fixtureTaskId === task.fixtureTaskId && row.snapshot.basis.projectVersion === task.basis.projectVersion && row.snapshot.origin === task.origin && (task.fixtureTaskId !== null || row.snapshot.basis.analysisIds.join() === task.basis.analysisIds.join()) && !current.find((item) => item.id === row.snapshot.id)?.basisStale);
      if (same) continue;
      const now = new Date(task.createdAt);
      await tx.insert(modificationTasks).values({ id: task.id, workspaceId, projectId, revision: 1, snapshot: task, createdAt: now, updatedAt: now });
      await tx.insert(modificationTaskEvents).values({ taskId: task.id, workspaceId, revision: 1, action: "generated", actorId, snapshot: task, createdAt: now });
    }
  });
  return listTasks(workspaceId, projectId);
}

async function mutateTask(workspaceId: string, projectId: string, taskId: string, actorId: string, expectedRevision: number, action: string, change: (task: ModificationTask) => void) {
  const current = await getTask(workspaceId, projectId, taskId);
  return getDatabase().transaction(async (tx) => {
    const [project] = await tx.select({ version: projects.version }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    if (!project) return notFound();
    const [row] = await tx.select().from(modificationTasks).where(and(eq(modificationTasks.id, taskId), eq(modificationTasks.workspaceId, workspaceId), eq(modificationTasks.projectId, projectId))).for("update");
    if (!row) return notFound();
    if (row.revision !== expectedRevision) throw new AppError(409, "TASK_VERSION_CONFLICT", "任务已更新，请重新读取后操作。");
    const task = structuredClone(row.snapshot);
    task.basisStale = current.basisStale || task.basis.projectVersion !== project.version;
    if (task.state === "cancelled") throw new AppError(409, "TASK_CANCELLED", "已取消任务仅保留历史记录。");
    change(task);
    task.revision += 1;
    task.updatedAt = new Date().toISOString();
    task.actorId = actorId;
    await tx.update(modificationTasks).set({ revision: task.revision, snapshot: task, updatedAt: new Date(task.updatedAt) }).where(eq(modificationTasks.id, taskId));
    await tx.insert(modificationTaskEvents).values({ taskId, workspaceId, revision: task.revision, action, actorId, snapshot: task, createdAt: new Date(task.updatedAt) });
    return task;
  });
}

export async function editTask(workspaceId: string, projectId: string, taskId: string, actorId: string, input: z.infer<typeof taskDraftSchema>) {
  return mutateTask(workspaceId, projectId, taskId, actorId, input.expectedRevision, "draft_edited", (task) => {
    if (input.targetUrl !== task.targetUrl) throw new AppError(409, "TASK_TARGET_REVIEW_REQUIRED", "修改目标页面需要新的页面诊断依据，请重新生成任务，不沿用旧页面证据。");
    task.title = input.title; task.position = input.position; task.proposedText = input.proposedText; task.conditions = input.conditions;
    task.draftVersion += 1; task.currentApprovalId = null;
    task.releases.forEach((release) => { release.superseded = true; });
    task.state = task.missingFactIds.length || task.basisStale || task.type === "missing_facts" ? "needs_material" : "awaiting_approval";
  });
}

export async function commitTaskVerification(workspaceId: string, projectId: string, taskId: string, actorId: string, expectedRevision: number, verification: TaskVerification) {
  return mutateTask(workspaceId, projectId, taskId, actorId, expectedRevision, verification.source === "independent_manual" ? "independently_verified" : "conditions_checked", (task) => {
    const release = task.releases.find((entry) => entry.id === verification.releaseId);
    if (!release || release.superseded || release.approvalId !== task.currentApprovalId || task.basisStale) throw new AppError(409, "TASK_APPROVAL_STALE", "核验期间批准版本已变化，不能写入过期结果。");
    task.verifications.push(verification); release.latestVerificationId = verification.id; release.verificationSource = verification.source;
    if (verification.allPassed) {
      if (verification.isSynthetic) release.syntheticAllConditionsPassedAt ??= verification.observedAt;
      else release.firstAllConditionsPassedAt ??= verification.executedAt;
      task.state = verification.isSynthetic ? "synthetic_verified_pending_review" : "verified_pending_review";
    } else task.state = "awaiting_verification";
  });
}

export async function performTaskAction(workspaceId: string, projectId: string, taskId: string, actorId: string, input: z.infer<typeof taskActionSchema>, isLocalOperator: boolean) {
  if (input.action === "verify" || input.action === "manual_verify") {
    const task = await getTask(workspaceId, projectId, taskId);
    if (task.revision !== input.expectedRevision) throw new AppError(409, "TASK_VERSION_CONFLICT", "任务已更新，请重新读取。");
    if (!input.releaseId || !input.source) throw new AppError(400, "RELEASE_REQUIRED", "请先指定已审核且已申报的发布版本和核验来源。");
    if (input.action === "manual_verify" && !isLocalOperator) throw new AppError(403, "OPERATOR_REQUIRED", "人工核验需独立操作员，客户不能以自己的发布申报代替核验。");
    if (input.action === "manual_verify" && (input.method !== "independent_snapshot_comparison" || input.source !== "synthetic_fixture")) throw new AppError(400, "INDEPENDENT_EVIDENCE_REQUIRED", "网页入口人工核验需固定合成前后快照；真实独立材料请由操作员CLI录入。");
    const verification = await prepareTaskVerification(task, input.releaseId, actorId, { source: input.source, snapshotId: input.snapshotId, beforeSnapshotId: input.beforeSnapshotId, manual: input.action === "manual_verify", reason: input.reason });
    return commitTaskVerification(workspaceId, projectId, taskId, actorId, input.expectedRevision, verification);
  }
  return mutateTask(workspaceId, projectId, taskId, actorId, input.expectedRevision, input.action, (task) => {
    if (input.action === "cancel") {
      if (!input.reason) throw new AppError(400, "CANCEL_REASON_REQUIRED", "取消任务需要具体原因。");
      task.state = "cancelled"; task.cancelReason = input.reason; task.currentApprovalId = null;
      task.releases.forEach((release) => { release.superseded = true; });
    } else if (input.action === "approve") {
      if (task.currentApprovalId) throw new AppError(409, "TASK_ALREADY_APPROVED", "当前草稿已审核，请直接申报发布；修改后需重新审核。");
      validateTaskApproval(task);
      const approval = { id: randomUUID(), draftVersion: task.draftVersion, projectVersion: task.basis.projectVersion, approvedAt: new Date().toISOString(), actorId, approvedText: task.proposedText, conditions: structuredClone(task.conditions), isSynthetic: task.isSynthetic };
      task.approvals.push(approval); task.currentApprovalId = approval.id;
      task.state = task.type === "third_party_correction" ? "waiting_external" : "awaiting_publication";
    } else if (input.action === "declare") {
      const approval = task.approvals.find((entry) => entry.id === task.currentApprovalId);
      if (!approval || task.basisStale || approval.draftVersion !== task.draftVersion) throw new AppError(409, "TASK_APPROVAL_REQUIRED", "请先审核当前草稿与依据，再申报发布。");
      if (!input.declaredPublishedAt || new Date(input.declaredPublishedAt) > new Date()) throw new AppError(400, "PUBLICATION_TIME_REQUIRED", "请填写已发生的发布时间；申报本身不证明上线。");
      task.releases.forEach((release) => { release.superseded = true; });
      task.releases.push({ id: randomUUID(), taskId, projectId, taskRevision: task.draftVersion, approvalId: approval.id, releaseVersion: task.releases.length + 1, declaredPublishedAt: input.declaredPublishedAt, createdAt: new Date().toISOString(), firstAllConditionsPassedAt: null, syntheticAllConditionsPassedAt: null, isSynthetic: task.isSynthetic, verificationSource: null, superseded: false, latestVerificationId: null, requiredForComparison: task.requiredForComparison, projectVersion: task.basis.projectVersion, affectedQuestionIds: task.affectedQuestionIds, reviewReportIds: [] });
      task.state = "awaiting_verification";
    }
  });
}

// Trusted report generation calls this after a report is actually persisted.
// No customer HTTP endpoint accepts an arbitrary "reviewed=true" declaration.
export async function markTaskReviewed(workspaceId: string, projectId: string, taskId: string, actorId: string, releaseId: string, reportId: string) {
  const task = await getTask(workspaceId, projectId, taskId);
  return mutateTask(workspaceId, projectId, taskId, actorId, task.revision, "report_recorded", (current) => {
    const release = current.releases.find((entry) => entry.id === releaseId);
    if (!release || release.superseded || (!release.firstAllConditionsPassedAt && !release.syntheticAllConditionsPassedAt)) throw new AppError(409, "REVIEW_NOT_READY", "该发布版本尚未全部核验通过。");
    if (!release.reviewReportIds.includes(reportId)) release.reviewReportIds.push(reportId);
    current.state = release.isSynthetic ? "synthetic_reviewed" : "reviewed";
  });
}
