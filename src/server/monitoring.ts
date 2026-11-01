import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { monitoringEvents, monitoringOccurrences, monitoringPlans } from "@/db/monitoring-schema";
import { projects } from "@/db/schema";
import { questionSets } from "@/db/question-schema";
import { pageCollections } from "@/db/page-schema";
import type { MonitoringOccurrence, MonitoringPlan, MonitoringState } from "@/lib/monitoring-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { getConfirmedSamplingQuestions, getQuestionSet } from "./questions";
import { getPageCollection } from "./page-repository";
import { addCalendarDays, chooseCatchUp, localDate, parseCalendarDate, planCalendar, validateTimezone } from "./monitoring-calendar";

export const createMonitoringPlanSchema = z.object({
  expectedProjectVersion: z.number().int().positive(),
  questionVersion: z.number().int().positive(),
  expectedPageCollectionVersion: z.number().int().positive(),
  firstBaselineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().default("Asia/Shanghai"),
  repeatsPerDay: z.number().int().min(1).max(3).default(1),
  mode: z.enum(["synthetic_fixture", "real_domestic"]),
  channelConfigVersion: z.string().trim().min(1).max(80),
}).strict();

export const monitoringStateSchema = z.object({
  expectedRevision: z.number().int().positive(), state: z.enum(["active", "paused", "cancelled"]),
}).strict();

type CreatePlanInput = z.infer<typeof createMonitoringPlanSchema>;
type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0];

function missing(): never { throw new AppError(404, "MONITORING_PLAN_NOT_FOUND", "未找到该监测计划。"); }

function occurrenceRows(plan: MonitoringPlan, from: string, through: string) {
  return planCalendar(plan.firstBaselineDate, plan.timezone, from, through).map((slot) => {
    const snapshot: MonitoringOccurrence = {
      id: randomUUID(), planId: plan.id, workspaceId: plan.workspaceId, projectId: plan.projectId,
      purpose: slot.purpose, scheduledAt: slot.scheduledAt, plannedLocalDate: slot.localDate,
      state: "planned", runId: null, dispatchedAt: null, reason: null,
    };
    return { id: snapshot.id, planId: plan.id, workspaceId: plan.workspaceId, projectId: plan.projectId,
      purpose: snapshot.purpose, scheduledAt: new Date(snapshot.scheduledAt), state: snapshot.state, snapshot };
  });
}

async function event(tx: DatabaseTransaction, plan: MonitoringPlan, actorId: string, action: string, details: Record<string, unknown>) {
  await tx.insert(monitoringEvents).values({ id: randomUUID(), planId: plan.id, workspaceId: plan.workspaceId, projectId: plan.projectId,
    actorId, action, details, createdAt: new Date() });
}

export async function monitoringPrerequisites(workspaceId: string, projectId: string) {
  const [project, questionSet, collection] = await Promise.all([
    getProject(workspaceId, projectId), getQuestionSet(workspaceId, projectId), getPageCollection(workspaceId, projectId),
  ]);
  return { projectVersion: project.version, questionVersion: questionSet.latestConfirmedVersion,
    questionDraftPending: questionSet.status !== "confirmed", pageCollectionVersion: collection.collection.version,
    timezone: "Asia/Shanghai", isSynthetic: project.isSynthetic };
}

export async function createMonitoringPlan(workspaceId: string, actorId: string, projectId: string, input: CreatePlanInput): Promise<MonitoringPlan> {
  const project = await getProject(workspaceId, projectId);
  const { inputs } = await getConfirmedSamplingQuestions(workspaceId, projectId, input.questionVersion);
  const timezone = validateTimezone(input.timezone);
  parseCalendarDate(input.firstBaselineDate);
  const today = localDate(new Date(), timezone);
  if (input.firstBaselineDate < today || input.firstBaselineDate > addCalendarDays(today, 30)) {
    throw new AppError(400, "BASELINE_DATE_INVALID", "基线从今天或未来30天内开始，不能补写历史日期。");
  }
  if (input.mode === "synthetic_fixture" && !project.isSynthetic) throw new AppError(400, "SYNTHETIC_PROJECT_REQUIRED", "合成回放仅限明确标识的合成项目。");
  const now = new Date().toISOString();
  const plan: MonitoringPlan = {
    id: randomUUID(), workspaceId, projectId, revision: 1, state: "active", timezone,
    projectVersion: input.expectedProjectVersion, questionVersion: input.questionVersion,
    pageCollectionVersion: input.expectedPageCollectionVersion, questionIds: inputs.map((q) => q.questionId),
    focusQuestionIds: inputs.filter((q) => q.isFocus).map((q) => q.questionId), repeatsPerDay: input.repeatsPerDay,
    firstBaselineDate: input.firstBaselineDate, mode: input.mode, channelConfigVersion: input.channelConfigVersion,
    isSynthetic: input.mode === "synthetic_fixture", createdAt: now, createdBy: actorId, updatedAt: now,
  };
  await getDatabase().transaction(async (tx) => {
    const [current] = await tx.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId))).for("update");
    if (!current) return missing();
    const [qs] = await tx.select().from(questionSets).where(and(eq(questionSets.workspaceId, workspaceId), eq(questionSets.projectId, projectId))).for("update");
    const [pc] = await tx.select().from(pageCollections).where(and(eq(pageCollections.workspaceId, workspaceId), eq(pageCollections.projectId, projectId))).for("update");
    if (current.version !== input.expectedProjectVersion || qs?.snapshot.latestConfirmedVersion !== input.questionVersion
      || qs?.snapshot.status !== "confirmed" || (pc?.version ?? 0) !== input.expectedPageCollectionVersion || !pc?.snapshot.pages.length) {
      throw new AppError(409, "MONITORING_VERSIONS_CHANGED", "品牌、问题或页面版本已变化，请重新核对再冻结基线。");
    }
    const [active] = await tx.select({ id: monitoringPlans.id }).from(monitoringPlans)
      .where(and(eq(monitoringPlans.workspaceId, workspaceId), eq(monitoringPlans.projectId, projectId), eq(monitoringPlans.state, "active"))).limit(1);
    if (active) throw new AppError(409, "MONITORING_PLAN_ACTIVE", "已有运行中的监测计划，请先暂停或取消后再建立新版本。");
    await tx.insert(monitoringPlans).values({ id: plan.id, workspaceId, projectId, revision: 1, state: "active", snapshot: plan, createdAt: new Date(now), updatedAt: new Date(now) });
    const occurrences = occurrenceRows(plan, input.firstBaselineDate, addCalendarDays(input.firstBaselineDate, 30));
    if (occurrences.length) await tx.insert(monitoringOccurrences).values(occurrences);
    await event(tx, plan, actorId, "created", { frozenPlan: plan });
  });
  return plan;
}

export async function listMonitoringPlans(workspaceId: string, projectId: string): Promise<MonitoringPlan[]> {
  await getProject(workspaceId, projectId);
  return (await getDatabase().select({ snapshot: monitoringPlans.snapshot }).from(monitoringPlans)
    .where(and(eq(monitoringPlans.workspaceId, workspaceId), eq(monitoringPlans.projectId, projectId))).orderBy(desc(monitoringPlans.createdAt))).map((row) => row.snapshot);
}

export async function getMonitoringPlan(workspaceId: string, projectId: string, planId: string): Promise<MonitoringPlan> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: monitoringPlans.snapshot }).from(monitoringPlans)
    .where(and(eq(monitoringPlans.workspaceId, workspaceId), eq(monitoringPlans.projectId, projectId), eq(monitoringPlans.id, planId))).limit(1);
  return row?.snapshot ?? missing();
}

export async function changeMonitoringState(workspaceId: string, actorId: string, projectId: string, planId: string, expectedRevision: number, state: MonitoringState): Promise<MonitoringPlan> {
  await getProject(workspaceId, projectId);
  return getDatabase().transaction(async (tx) => {
    // Serialize active-plan creation/resume on the same project lock.
    await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    const [row] = await tx.select().from(monitoringPlans).where(and(eq(monitoringPlans.id, planId), eq(monitoringPlans.workspaceId, workspaceId), eq(monitoringPlans.projectId, projectId))).for("update");
    if (!row) return missing();
    if (row.revision !== expectedRevision) throw new AppError(409, "MONITORING_PLAN_CONFLICT", "监测计划已被更新，请重新读取。");
    if (row.state === "cancelled" && state !== "cancelled") throw new AppError(409, "MONITORING_PLAN_CANCELLED", "已取消的计划不能恢复，请建立新计划。");
    if (state === "active" && row.state !== "active") {
      const [other] = await tx.select({ id: monitoringPlans.id }).from(monitoringPlans).where(and(eq(monitoringPlans.workspaceId, workspaceId), eq(monitoringPlans.projectId, projectId), eq(monitoringPlans.state, "active"))).limit(1);
      if (other) throw new AppError(409, "MONITORING_PLAN_ACTIVE", "已有运行中的监测计划。");
    }
    const plan: MonitoringPlan = { ...row.snapshot, state, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    await tx.update(monitoringPlans).set({ state, revision: plan.revision, snapshot: plan, updatedAt: new Date(plan.updatedAt) }).where(eq(monitoringPlans.id, planId));
    const pending = await tx.select().from(monitoringOccurrences).where(and(eq(monitoringOccurrences.planId, planId), inArray(monitoringOccurrences.state, state === "active" ? ["paused", "blocked"] : ["planned", "paused", "blocked"])));
    for (const occurrence of pending) {
      const nextState = state === "active" ? "planned" : state;
      const snapshot: MonitoringOccurrence = { ...occurrence.snapshot, state: nextState, reason: state === "active" ? null : "计划已暂停或取消；已受理供应商任务仍会核对和结算。" };
      await tx.update(monitoringOccurrences).set({ state: nextState, snapshot }).where(eq(monitoringOccurrences.id, occurrence.id));
    }
    await event(tx, plan, actorId, `state_${state}`, { previousState: row.state, revision: plan.revision });
    return plan;
  });
}

export async function listMonitoringOccurrences(workspaceId: string, projectId: string, planId: string): Promise<MonitoringOccurrence[]> {
  await getMonitoringPlan(workspaceId, projectId, planId);
  return (await getDatabase().select({ snapshot: monitoringOccurrences.snapshot }).from(monitoringOccurrences)
    .where(and(eq(monitoringOccurrences.workspaceId, workspaceId), eq(monitoringOccurrences.projectId, projectId), eq(monitoringOccurrences.planId, planId)))
    .orderBy(asc(monitoringOccurrences.scheduledAt)).limit(500)).map((row) => row.snapshot);
}

export interface MonitoringDispatch { runId: string | null; blockedReason?: string }
export type MonitoringDispatcher = (plan: MonitoringPlan, occurrence: MonitoringOccurrence) => Promise<MonitoringDispatch>;

// Registered by the independent worker. A deterministic execution key in the
// sampling service makes replay safe if it crashes after createRun but before
// this occurrence commits. Querying accepted supplier work remains independent.
export async function dispatchDueMonitoring(dispatch: MonitoringDispatcher, now = new Date()): Promise<number> {
  const db = getDatabase();
  const plans = await db.select().from(monitoringPlans).where(eq(monitoringPlans.state, "active"));
  let count = 0;
  for (const candidate of plans) {
    if (candidate.snapshot.isSynthetic) continue; // Fixed historical fixtures only run by an explicit replay action.
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(monitoringPlans).where(and(eq(monitoringPlans.id, candidate.id), eq(monitoringPlans.state, "active"))).for("update", { skipLocked: true });
      if (!locked) return;
      const plan = locked.snapshot;
      const today = localDate(now, plan.timezone);
      const extended = occurrenceRows(plan, addCalendarDays(today, -30), addCalendarDays(today, 30));
      if (extended.length) await tx.insert(monitoringOccurrences).values(extended).onConflictDoNothing();
      const rows = await tx.select().from(monitoringOccurrences).where(and(eq(monitoringOccurrences.planId, plan.id), eq(monitoringOccurrences.state, "planned"), lte(monitoringOccurrences.scheduledAt, now))).orderBy(asc(monitoringOccurrences.scheduledAt));
      for (const purpose of ["baseline", "focus", "full", "review-1", "review-2"] as const) {
        const { dispatch: selected, missed } = chooseCatchUp(rows.filter((row) => row.snapshot.purpose === purpose).map((row) => row.snapshot), now);
        for (const occurrence of missed) {
          const snapshot: MonitoringOccurrence = { ...occurrence, state: "missed", reason: "错过计划；48小时内仅补最近一次，实际日期不会补写。" };
          await tx.update(monitoringOccurrences).set({ state: snapshot.state, snapshot }).where(eq(monitoringOccurrences.id, snapshot.id));
          await event(tx, plan, "monitoring-worker", "missed", { occurrenceId: snapshot.id, scheduledAt: snapshot.scheduledAt });
        }
        for (const occurrence of selected) {
          const result = await dispatch(plan, occurrence);
          const snapshot: MonitoringOccurrence = { ...occurrence, state: result.blockedReason ? "blocked" : "dispatched", runId: result.runId,
            dispatchedAt: now.toISOString(), reason: result.blockedReason ?? (occurrence.plannedLocalDate === today ? null : "48小时内补最近一次，使用实际采集日期。") };
          await tx.update(monitoringOccurrences).set({ state: snapshot.state, snapshot }).where(eq(monitoringOccurrences.id, snapshot.id));
          await event(tx, plan, "monitoring-worker", snapshot.state, { occurrenceId: snapshot.id, runId: result.runId, actualDispatchAt: now.toISOString() });
          count++;
        }
      }
    });
  }
  return count;
}
