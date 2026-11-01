import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { answerEvidence, runEvidence, runUnits, samplingRuns, samplingUnits } from "@/db/sampling-schema";
import type { CreateRunInput, EvidenceRecord, RawFixtureEvidence, SamplingRun, SamplingUnit } from "@/lib/sampling-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { getConfirmedSamplingQuestions } from "./questions";
import { fixtureGroupMap, getFixtureSeed, loadFixturePeriod } from "./synthetic-fixtures";
import { markBudgetUnknown, releaseBudget, reserveBudget, settleBudget } from "./budgets";

export const createRunSchema = z.object({
  mode: z.enum(["synthetic_fixture", "synthetic_operations", "real_domestic"]),
  period: z.enum(["baseline", "review-1", "review-2", "edge"]),
  questionVersion: z.number().int().positive(), projectVersion: z.number().int().positive().optional(),
  siteVersion: z.string().max(80).optional(), channelConfigVersion: z.string().max(80).optional(),
  executionKey: z.string().max(160).optional(), batchKey: z.string().trim().min(1).max(80).optional(),
  newBatchConfirmed: z.boolean().optional(), purposes: z.array(z.string().max(40)).max(8).optional(),
  questionIds: z.array(z.uuid()).min(1).max(20).optional(), repeatsPerDay: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  requestedCollectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  samplingConditions: z.object({ channel: z.string().nullable(), platform: z.string().nullable(), model: z.string().nullable(), region: z.string().nullable(), language: z.string().nullable(), search: z.string().nullable() }).strict().optional(),
  operationScenario: z.enum(["normal", "unknown_submission", "retryable_not_accepted"]).optional(),
}).strict();

export async function listRuns(workspaceId: string, projectId: string): Promise<SamplingRun[]> {
  await getProject(workspaceId, projectId);
  return (await getDatabase().select({ snapshot: samplingRuns.snapshot }).from(samplingRuns).where(and(eq(samplingRuns.workspaceId, workspaceId), eq(samplingRuns.projectId, projectId))).orderBy(desc(samplingRuns.createdAt)).limit(200)).map((r) => r.snapshot);
}
export async function getRun(workspaceId: string, projectId: string, id: string): Promise<SamplingRun> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select().from(samplingRuns).where(and(eq(samplingRuns.id, id), eq(samplingRuns.workspaceId, workspaceId), eq(samplingRuns.projectId, projectId)));
  if (!row) throw new AppError(404, "RUN_NOT_FOUND", "未找到该采样任务。");
  return row.snapshot;
}
export async function listEvidence(workspaceId: string, projectId: string): Promise<EvidenceRecord[]> {
  await getProject(workspaceId, projectId);
  return (await getDatabase().select({ snapshot: answerEvidence.snapshot }).from(answerEvidence).where(and(eq(answerEvidence.workspaceId, workspaceId), eq(answerEvidence.projectId, projectId))).orderBy(desc(answerEvidence.createdAt)).limit(2000)).map((r) => r.snapshot);
}
export async function getEvidence(workspaceId: string, projectId: string, id: string): Promise<EvidenceRecord> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select().from(answerEvidence).where(and(eq(answerEvidence.id, id), eq(answerEvidence.workspaceId, workspaceId), eq(answerEvidence.projectId, projectId)));
  if (!row) throw new AppError(404, "EVIDENCE_NOT_FOUND", "未找到该回答证据。");
  return row.snapshot;
}

export async function createRun(workspaceId: string, actorId: string, projectId: string, input: CreateRunInput): Promise<SamplingRun> {
  const project = await getProject(workspaceId, projectId);
  const { inputs } = await getConfirmedSamplingQuestions(workspaceId, projectId, input.questionVersion);
  if (input.mode === "real_domestic") throw new AppError(503, "REAL_CHANNEL_PENDING", "真实消费端通道待配置与真实验收；当前未发起外部请求或收费，也不会回退为合成回答。");
  if (!project.isSynthetic) throw new AppError(400, "SYNTHETIC_PROJECT_REQUIRED", "请显式创建合成演练项目后运行回放。");
  const seed = await getFixtureSeed(workspaceId, projectId);
  if (!seed || seed.projectVersion !== project.version || input.questionVersion !== seed.questionVersion || (input.projectVersion && input.projectVersion !== seed.projectVersion)) throw new AppError(409, "FIXTURE_VERSION_CHANGED", "固定回放只支持原始合成企业与问题版本；不能用编辑后的资料冒充原始样本。");
  if (input.batchKey && !input.newBatchConfirmed) throw new AppError(400, "NEW_BATCH_CONFIRMATION_REQUIRED", "新批次会产生新的执行记录和模拟消耗，请明确确认。");
  if (input.repeatsPerDay && input.repeatsPerDay !== 1) throw new AppError(400, "FIXTURE_REPEAT_FIXED", "固定资料每题每天仅一次，不能复制资料冒充多次采样。");
  if (input.requestedCollectionDate) throw new AppError(400, "FIXTURE_DATE_FIXED", "固定资料保留原演练日期，不能改写为新的实际采集日期。");
  if (input.samplingConditions || (input.channelConfigVersion && input.channelConfigVersion !== "config-v1") || (input.siteVersion && input.siteVersion !== (input.period === "baseline" ? "site-v1" : "site-v2"))) throw new AppError(400, "FIXTURE_CONFIG_FIXED", "固定资料保持原采样条件及页面版本，不能按请求改写历史证据。");
  const questionIds = [...new Set(input.questionIds ?? inputs.map((q) => q.questionId))].sort();
  if (questionIds.some((id) => !inputs.some((q) => q.questionId === id))) throw new AppError(400, "QUESTION_SCOPE_INVALID", "选题必须属于指定的已确认问题版本。");
  const raw = await loadFixturePeriod(input.period);
  const eligible = raw.filter((r) => r.workspace_id === "ws-chengyue" && questionIds.includes(seed.questionIds[r.question_id]));
  const operationScenario = input.operationScenario ?? "normal";
  // Clients cannot defeat deduplication by choosing an arbitrary execution key.
  const executionKey = createHash("sha256").update(JSON.stringify([projectId, project.version, input.questionVersion, input.mode, input.period, questionIds, operationScenario, input.batchKey ?? "default"])).digest("hex");
  const run = await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId + executionKey}, 0))`);
    const [prior] = await tx.select().from(samplingRuns).where(and(eq(samplingRuns.workspaceId, workspaceId), eq(samplingRuns.executionKey, executionKey)));
    if (prior) {
      const next = { ...prior.snapshot, purposes: [...new Set([...prior.snapshot.purposes, ...(input.purposes ?? ["manual"])])] };
      await tx.update(samplingRuns).set({ snapshot: next, updatedAt: new Date() }).where(eq(samplingRuns.id, prior.id));
      return next;
    }
    const now = new Date(); const id = randomUUID();
    const snapshot: SamplingRun = { id, workspaceId, projectId, mode: input.mode, period: input.period, questionVersion: input.questionVersion, projectVersion: seed.projectVersion,
      siteVersion: input.period === "baseline" ? "site-v1" : "site-v2", channelConfigVersion: "config-v1", executionKey, purposes: input.purposes ?? ["manual"],
      questionIds, repeatsPerDay: 1, plannedCount: new Set(eligible.map((r) => r.source_sample_key)).size, importedCount: 0, validCount: 0, failedCount: 0,
      excludedCount: raw.length - eligible.length, exclusions: raw.filter((r) => !eligible.includes(r)).map((r) => ({ sourceSampleId: r.sample_id, reason: "不属于本工作区合成企业或本次选题" })),
      status: "queued", jobId: null, reservationId: null, providerTaskId: null, submissionAttempts: 0, operationScenario, isSynthetic: true,
      createdAt: now.toISOString(), startedAt: null, completedAt: null, error: null, createdBy: actorId };
    await tx.insert(samplingRuns).values({ id, workspaceId, projectId, executionKey, status: snapshot.status, snapshot, createdAt: now, updatedAt: now });
    for (const entry of eligible) {
      const businessKey = createHash("sha256").update(JSON.stringify([projectId, input.mode, entry.source_sample_key, input.batchKey ?? "default", operationScenario])).digest("hex");
      const unit: SamplingUnit = { id: randomUUID(), workspaceId, projectId, businessKey, questionId: seed.questionIds[entry.question_id] ?? null, questionVersion: input.questionVersion, projectVersion: seed.projectVersion,
        mode: input.mode, period: input.period, sourceSampleKey: entry.source_sample_key, status: "queued", evidenceId: null, reservationId: null, providerTaskId: null, submissionAttempts: 0, operationScenario,
        createdAt: now.toISOString(), updatedAt: now.toISOString(), retryAfterAt: null, error: null };
      await tx.insert(samplingUnits).values({ id: unit.id, workspaceId, projectId, businessKey, status: "queued", snapshot: unit, rawFixture: entry, updatedAt: now }).onConflictDoNothing();
      const [stored] = await tx.select({ id: samplingUnits.id }).from(samplingUnits).where(and(eq(samplingUnits.workspaceId, workspaceId), eq(samplingUnits.businessKey, businessKey)));
      await tx.insert(runUnits).values({ runId: id, unitId: stored.id }).onConflictDoNothing();
    }
    return snapshot;
  });
  // A durable run is the outbox. The independent worker recovers queued rows
  // even when a web process stops before it can publish to pg-boss.
  return run;
}

export async function attachRunJob(id: string, jobId: string | null) {
  if (!jobId) return;
  await getDatabase().execute(sql`update sampling_runs set snapshot = jsonb_set(snapshot, '{jobId}', to_jsonb(${jobId}::text)), updated_at=now() where id=${id}::uuid`);
}

function normalize(raw: RawFixtureEvidence, run: SamplingRun, unit: SamplingUnit): EvidenceRecord {
  const capture = { questionVerified: raw.capture.question_verified, platformVerified: raw.capture.platform_verified, answerComplete: raw.capture.answer_complete, timeVerified: raw.capture.time_verified };
  return { id: randomUUID(), workspaceId: run.workspaceId, projectId: run.projectId, runId: run.id, questionId: unit.questionId, questionVersion: run.questionVersion,
    questionText: raw.question_text, questionGroup: fixtureGroupMap[raw.group] ?? null, projectVersion: run.projectVersion, sourceSampleId: raw.sample_id, sourceSampleKey: raw.source_sample_key,
    sourceType: raw.source_type, channelId: raw.channel_id, platform: raw.platform, surface: raw.surface, isSynthetic: true, period: run.period,
    collectedAt: raw.collected_at, importedAt: new Date().toISOString(), status: raw.status, answerText: raw.answer_text,
    isValid: raw.status === "success" && !!raw.answer_text?.trim() && !!raw.collected_at && Number.isFinite(Date.parse(raw.collected_at)) && Object.values(capture).every(Boolean),
    capture, citations: { status: raw.citations.status, bodyMappings: raw.citations.body_mappings }, sourceCandidates: raw.source_candidates, config: raw.config,
    providerTaskId: raw.provider_task_id, siteVersion: raw.site_version, releaseVersion: raw.release_version, cost: raw.cost, rawFixture: raw };
}

export async function processRun(workspaceId: string, projectId: string, id: string): Promise<SamplingRun> {
  let run = await getRun(workspaceId, projectId, id);
  if (["completed", "partial", "failed", "cancelled", "paused", "needs_reconciliation"].includes(run.status)) return run;
  const db = getDatabase();
  const started = { ...run, status: "running" as const, startedAt: run.startedAt ?? new Date().toISOString() };
  const claimed = await db.update(samplingRuns).set({ status: "running", snapshot: started, updatedAt: new Date() }).where(and(eq(samplingRuns.id, id), eq(samplingRuns.status, "queued"))).returning();
  if (!claimed.length) return getRun(workspaceId, projectId, id);
  run = started;
  const links = await db.select({ id: runUnits.unitId }).from(runUnits).where(eq(runUnits.runId, id));
  for (const link of links) {
    const current = await getRun(workspaceId, projectId, id);
    if (["paused", "cancelled"].includes(current.status)) break;
    // Claim briefly; all simulated supplier/budget work happens after commit.
    const record = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(samplingUnits).where(eq(samplingUnits.id, link.id)).for("update", { skipLocked: true });
      if (!r || ["completed", "needs_reconciliation", "failed", "cancelled", "processing"].includes(r.status)) return null;
      const next: SamplingUnit = { ...r.snapshot, status: "processing", updatedAt: new Date().toISOString() };
      await tx.update(samplingUnits).set({ status: next.status, snapshot: next, updatedAt: new Date() }).where(eq(samplingUnits.id, r.id));
      return { unit: next, raw: r.rawFixture as RawFixtureEvidence };
    });
    if (!record) continue;
    let unit = record.unit;
    try {
      if (run.mode === "synthetic_operations") {
        const reserved = await reserveBudget({ workspaceId, projectId, kind: "simulation", currency: "CNY", action: "sampling", executionKey: "unit:" + unit.businessKey, upperBoundMinor: 50 });
        unit = { ...unit, reservationId: reserved.id, providerTaskId: "synthetic-task:" + unit.id };
        if (run.operationScenario === "retryable_not_accepted") {
          for (let attempt = unit.submissionAttempts + 1; attempt <= 3; attempt++) {
            if (attempt > 1) {
              unit = { ...unit, retryAfterAt: new Date(Date.now() + 300 * 2 ** (attempt - 2)).toISOString() };
              await db.update(samplingUnits).set({ snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
              await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 2)));
            }
            const state = await getRun(workspaceId, projectId, id);
            if (["paused", "cancelled"].includes(state.status)) {
              if (state.status === "cancelled") await releaseBudget(workspaceId, reserved.id, "合成任务已取消且此前均明确未受理。");
              unit = { ...unit, status: state.status === "paused" ? "queued" : "cancelled", retryAfterAt: null };
              break;
            }
            unit = { ...unit, submissionAttempts: attempt, submissionState: "unknown", retryAfterAt: null };
            await db.update(samplingUnits).set({ snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
            // The isolated adapter returns an explicit not-accepted result. No
            // external call occurs, but each attempt and backoff is real work.
            unit = { ...unit, submissionState: "not_accepted" };
            await db.update(samplingUnits).set({ snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
          }
          if (unit.status === "processing") {
            await releaseBudget(workspaceId, reserved.id, "离线适配返回三次明确未受理，预留释放，没有实际计费。");
            unit = { ...unit, status: "failed", error: "合成限流：首次及最多两次退避重试后停止，无真实供应商调用。" };
          }
          await db.update(samplingUnits).set({ status: unit.status, snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
          continue;
        }
        unit = { ...unit, submissionAttempts: unit.submissionAttempts + 1, submissionState: "unknown" };
        // Persist intent before a supplier submission could occur. An interrupted
        // intent is reconciled; never interpreted as permission to submit again.
        await db.update(samplingUnits).set({ snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
        if (run.operationScenario === "unknown_submission") {
          await markBudgetUnknown(workspaceId, reserved.id, "合成故障：提交结果不明，保留预留，等待人工核对。");
          unit = { ...unit, status: "needs_reconciliation", error: "合成提交结果不明；未自动重提。" };
          await db.update(samplingUnits).set({ status: unit.status, snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
          continue;
        }
        await settleBudget(workspaceId, reserved.id, 40, "离线回放单条模拟实际0.40元，无外部收费。");
      }
      const evidence = normalize(record.raw, run, unit);
      await db.transaction(async (tx) => {
        await tx.insert(answerEvidence).values({ id: evidence.id, workspaceId, projectId, sourceSampleKey: evidence.sourceSampleKey, snapshot: evidence, createdAt: new Date() }).onConflictDoNothing();
        const [stored] = await tx.select().from(answerEvidence).where(and(eq(answerEvidence.workspaceId, workspaceId), eq(answerEvidence.projectId, projectId), eq(answerEvidence.sourceSampleKey, evidence.sourceSampleKey)));
        unit = { ...unit, status: "completed", evidenceId: stored.id, updatedAt: new Date().toISOString() };
        await tx.update(samplingUnits).set({ status: unit.status, snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
      });
    } catch (error) {
      unit = { ...unit, status: unit.submissionAttempts ? "needs_reconciliation" : "failed", error: error instanceof AppError ? error.message : "处理未完成，请核对任务与账本后恢复。" };
      if (unit.reservationId && unit.submissionAttempts) await markBudgetUnknown(workspaceId, unit.reservationId, unit.error!);
      await db.update(samplingUnits).set({ status: unit.status, snapshot: unit, updatedAt: new Date() }).where(eq(samplingUnits.id, unit.id));
    }
  }
  return refreshRun(workspaceId, projectId, id);
}

export async function refreshRun(workspaceId: string, projectId: string, id: string): Promise<SamplingRun> {
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(samplingRuns).where(and(eq(samplingRuns.id, id), eq(samplingRuns.workspaceId, workspaceId), eq(samplingRuns.projectId, projectId))).for("update");
    if (!row) throw new AppError(404, "RUN_NOT_FOUND", "未找到该采样任务。");
    const units = await tx.select({ snapshot: samplingUnits.snapshot }).from(runUnits).innerJoin(samplingUnits, eq(runUnits.unitId, samplingUnits.id)).where(eq(runUnits.runId, id));
    const completedIds = units.map((r) => r.snapshot.evidenceId).filter((v): v is string => !!v);
    const evidence = completedIds.length ? await tx.select().from(answerEvidence).where(inArray(answerEvidence.id, completedIds)) : [];
    for (const item of evidence) await tx.insert(runEvidence).values({ runId: id, evidenceId: item.id }).onConflictDoNothing();
    const unknown = units.some((r) => r.snapshot.status === "needs_reconciliation");
    const pending = units.some((r) => ["queued", "processing"].includes(r.snapshot.status));
    const status = ["paused", "cancelled"].includes(row.status) ? row.snapshot.status : unknown ? "needs_reconciliation" : pending ? "queued" : evidence.length === row.snapshot.plannedCount && evidence.every((r) => r.snapshot.isValid) ? "completed" : evidence.some((r) => r.snapshot.isValid) ? "partial" : "failed";
    const snapshot: SamplingRun = { ...row.snapshot, status, importedCount: evidence.length, validCount: evidence.filter((r) => r.snapshot.isValid).length,
      failedCount: units.filter((r) => r.snapshot.status === "failed").length + evidence.filter((r) => !r.snapshot.isValid).length,
      submissionAttempts: units.reduce((sum, r) => sum + r.snapshot.submissionAttempts, 0), reservationId: units.find((r) => r.snapshot.reservationId)?.snapshot.reservationId ?? null,
      providerTaskId: units.find((r) => r.snapshot.providerTaskId)?.snapshot.providerTaskId ?? null,
      completedAt: pending || unknown ? null : new Date().toISOString(), error: units.find((r) => r.snapshot.error)?.snapshot.error ?? null };
    await tx.update(samplingRuns).set({ status, snapshot, updatedAt: new Date() }).where(eq(samplingRuns.id, id));
    return snapshot;
  });
}

export async function changeRunState(workspaceId: string, projectId: string, id: string, action: "pause" | "resume" | "cancel"): Promise<SamplingRun> {
  await getRun(workspaceId, projectId, id);
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(samplingRuns).where(eq(samplingRuns.id, id)).for("update");
    const allowed = action === "resume" ? ["paused"] : ["queued", "running", "paused"];
    if (!allowed.includes(row.status)) throw new AppError(409, "RUN_STATE_CONFLICT", "当前任务状态不支持此操作；已受理或待核对的任务应先核对账单。");
    const status = action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "queued";
    const snapshot: SamplingRun = { ...row.snapshot, status };
    await tx.update(samplingRuns).set({ status, snapshot, updatedAt: new Date() }).where(eq(samplingRuns.id, id));
    return snapshot;
  });
}

export async function reconcileRun(workspaceId: string, actorId: string, projectId: string, id: string, input: { accepted: boolean; actualMinor: number; reason: string }) {
  if (!Number.isSafeInteger(input.actualMinor) || input.actualMinor < 0 || input.actualMinor > 50 || input.reason.trim().length < 8 || (!input.accepted && input.actualMinor !== 0)) throw new AppError(400, "INVALID_RECONCILIATION", "请提供逐条模拟费用与至少8字核对依据；明确未受理费用须为零。");
  const run = await getRun(workspaceId, projectId, id);
  if (!run.isSynthetic || run.mode !== "synthetic_operations") throw new AppError(400, "SYNTHETIC_RECONCILIATION_ONLY", "本入口只核对离线模拟账本，不能作为真实供应商费用结论。");
  const db = getDatabase();
  const units = await db.select({ row: samplingUnits }).from(runUnits).innerJoin(samplingUnits, eq(runUnits.unitId, samplingUnits.id)).where(eq(runUnits.runId, id));
  for (const { row } of units) {
    if (row.status !== "needs_reconciliation" || !row.snapshot.reservationId) continue;
    const reason = `${actorId}：${input.reason}`;
    if (input.accepted) await settleBudget(workspaceId, row.snapshot.reservationId, input.actualMinor, reason);
    else { if (input.actualMinor !== 0) throw new AppError(400, "INVALID_UNACCEPTED_COST", "明确未受理须确认实际费用为零。"); await releaseBudget(workspaceId, row.snapshot.reservationId, reason); }
    const snapshot: SamplingUnit = { ...row.snapshot, status: "failed", error: "模拟费用已核对；未取得新回答，不重新提交；" + reason };
    await db.update(samplingUnits).set({ status: snapshot.status, snapshot, updatedAt: new Date() }).where(eq(samplingUnits.id, row.id));
  }
  return refreshRun(workspaceId, projectId, id);
}

export async function recoverInterruptedRuns() {
  // Worker ownership uses a process-level advisory lock. With no predecessor
  // still running, unfinished units are safe to classify from persisted intent.
  const db = getDatabase();
  const interrupted = await db.select().from(samplingUnits).where(eq(samplingUnits.status, "processing"));
  for (const row of interrupted) {
    const submitted = row.snapshot.submissionAttempts > 0 && row.snapshot.submissionState !== "not_accepted";
    const snapshot: SamplingUnit = { ...row.snapshot, status: submitted ? "needs_reconciliation" : "queued", error: submitted ? "worker中断，已保存提交意图，先核对原任务，未自动重提。" : null };
    if (submitted && snapshot.reservationId) await markBudgetUnknown(snapshot.workspaceId, snapshot.reservationId, snapshot.error!);
    await db.update(samplingUnits).set({ status: snapshot.status, snapshot, updatedAt: new Date() }).where(eq(samplingUnits.id, row.id));
  }
  const running = await db.select().from(samplingRuns).where(eq(samplingRuns.status, "running"));
  for (const row of running) await refreshRun(row.workspaceId, row.projectId, row.id);
}
