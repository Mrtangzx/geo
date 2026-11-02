import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { manualImportBatches, manualSourceKeys } from "@/db/import-schema";
import { answerEvidence } from "@/db/sampling-schema";
import { projects } from "@/db/schema";
import type { ImportPreview, ImportPreviewRow, ManualImportBatch, ManualImportInput } from "@/lib/import-contracts";
import type { EvidenceRecord } from "@/lib/sampling-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { getConfirmedSamplingQuestions } from "./questions";
import { importFingerprint, manualContentHash, manualRowSchema, manualRowWarnings, manualSourceKey, parseImportRows, type ManualRow } from "./import-validation";

interface PreparedRow { row: ManualRow; questionId: string; group: EvidenceRecord["questionGroup"]; payloadHash: string; sourceKey: string }
async function prepare(workspaceId: string, projectId: string, input: ManualImportInput) {
  const project = await getProject(workspaceId, projectId);
  if (project.version !== input.projectVersion) throw new AppError(409, "IMPORT_PROJECT_CHANGED", "品牌资料已变化，请重新选择版本并预览。");
  const { inputs: questions } = await getConfirmedSamplingQuestions(workspaceId, projectId, input.questionVersion);
  const prepared: PreparedRow[] = []; const previews: ImportPreviewRow[] = [];
  const seenContent = new Set<string>(); const seenSources = new Map<string, string>();
  for (const item of parseImportRows(input.content, input.format)) {
    const parsed = manualRowSchema.safeParse(item.value);
    const base: ImportPreviewRow = { line: item.line, sourceId: "", questionText: "", platform: "", valid: false, duplicate: false, duplicateEvidenceId: null, warnings: [], errors: [] };
    if (item.error || !parsed.success) { base.errors = item.error ? [item.error] : parsed.error!.issues.map((i) => `${i.path.join(".") || "记录"}：${i.message}`); previews.push(base); continue; }
    const row = parsed.data;
    Object.assign(base, { sourceId: row.sourceId, questionText: row.questionText, platform: row.platform });
    const candidates = questions.filter((q) => q.text === row.questionText && (!row.questionId || q.questionId === row.questionId));
    if (candidates.length !== 1) base.errors.push("实际提问必须唯一匹配指定的已确认问题版本；可补充该版本的问题ID，不能改写原问题。");
    if (row.isSynthetic !== project.isSynthetic) base.errors.push("资料的合成标记与项目不一致；请使用对应的独立项目，不能把合成回答改为真实来源。");
    if (base.errors.length) { previews.push(base); continue; }
    const question = candidates[0];
    const payloadHash = manualContentHash(row, input.projectVersion, input.questionVersion, question.questionId);
    const sourceKey = manualSourceKey(row);
    if (seenSources.has(sourceKey) && seenSources.get(sourceKey) !== payloadHash) base.errors.push("本批同一来源ID对应不同内容；请核对原始记录，不能覆盖证据。");
    seenSources.set(sourceKey, payloadHash);
    const [priorSource] = await getDatabase().select().from(manualSourceKeys).where(and(eq(manualSourceKeys.workspaceId, workspaceId), eq(manualSourceKeys.projectId, projectId), eq(manualSourceKeys.sourceKey, sourceKey)));
    if (priorSource && priorSource.payloadHash !== payloadHash) base.errors.push("该来源ID已保存过不同内容，旧原文不可覆盖；如为新采集请提供新的来源ID。");
    const [priorEvidence] = await getDatabase().select({ id: answerEvidence.id, period: sql<string>`${answerEvidence.snapshot}->>'period'` }).from(answerEvidence)
      .where(and(eq(answerEvidence.workspaceId, workspaceId), eq(answerEvidence.projectId, projectId), eq(answerEvidence.sourceSampleKey, "manual-v1:" + payloadHash)));
    base.duplicate = seenContent.has(payloadHash) || !!priorEvidence;
    base.duplicateEvidenceId = priorEvidence?.id ?? null;
    base.warnings = manualRowWarnings(row);
    if (base.duplicate) base.warnings.push(`重复原始资料会复用已有证据，不增加统计样本${priorEvidence ? `；原时期为${priorEvidence.period}` : ""}。`);
    base.valid = row.status === "success" && !!row.answerText?.trim() && !!row.collectedAt && row.surface !== "unknown" && Object.values(row.capture).every(Boolean);
    seenContent.add(payloadHash); previews.push(base);
    prepared.push({ row, questionId: question.questionId, group: question.group, payloadHash, sourceKey });
  }
  const preview: ImportPreview = { fingerprint: importFingerprint(input), rows: previews, total: previews.length,
    valid: previews.filter((p) => p.valid && !p.errors.length).length, incomplete: previews.filter((p) => !p.valid && !p.errors.length).length,
    duplicates: previews.filter((p) => p.duplicate).length, canCommit: previews.length > 0 && previews.every((p) => !p.errors.length) };
  return { preview, prepared, project };
}

export async function previewManualImport(workspaceId: string, projectId: string, input: ManualImportInput): Promise<ImportPreview> {
  return (await prepare(workspaceId, projectId, input)).preview;
}
export async function listManualImports(workspaceId: string, projectId: string): Promise<ManualImportBatch[]> {
  await getProject(workspaceId, projectId);
  return (await getDatabase().select({ snapshot: manualImportBatches.snapshot }).from(manualImportBatches)
    .where(and(eq(manualImportBatches.workspaceId, workspaceId), eq(manualImportBatches.projectId, projectId))).orderBy(desc(manualImportBatches.createdAt)).limit(100)).map((r) => r.snapshot);
}
export async function getManualImport(workspaceId: string, projectId: string, id: string) {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select().from(manualImportBatches).where(and(eq(manualImportBatches.id, id), eq(manualImportBatches.workspaceId, workspaceId), eq(manualImportBatches.projectId, projectId)));
  if (!row) throw new AppError(404, "IMPORT_NOT_FOUND", "未找到该导入批次。");
  return { batch: row.snapshot, rawContent: row.rawContent };
}

export async function commitManualImport(workspaceId: string, actorId: string, projectId: string, input: ManualImportInput, confirmation: { requestId: string; fingerprint: string }): Promise<ManualImportBatch> {
  const { preview, prepared, project } = await prepare(workspaceId, projectId, input);
  if (preview.fingerprint !== confirmation.fingerprint) throw new AppError(409, "IMPORT_PREVIEW_CHANGED", "资料或版本与预览不一致，本次未写入，请重新预览。");
  if (!preview.canCommit) throw new AppError(400, "IMPORT_HAS_ERRORS", "预览中有错误，本批未写入；请修正后重新提交。");
  const now = new Date(); const batchId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    // Serialize imports and attachments per project; no network work in this transaction.
    const [current] = await tx.select({ version: projects.version }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    if (current?.version !== input.projectVersion) throw new AppError(409, "IMPORT_PROJECT_CHANGED", "品牌资料已变化，未写入过期版本。");
    const [priorBatch] = await tx.select().from(manualImportBatches).where(and(eq(manualImportBatches.workspaceId, workspaceId), eq(manualImportBatches.projectId, projectId), eq(manualImportBatches.requestId, confirmation.requestId)));
    if (priorBatch) {
      if (priorBatch.fingerprint !== preview.fingerprint) throw new AppError(409, "IMPORT_REQUEST_CONFLICT", "同一提交标识不能替换文件内容。");
      return priorBatch.snapshot;
    }
    const evidenceIds: string[] = []; let created = 0; let duplicates = 0;
    for (const entry of prepared) {
      const { row, sourceKey, payloadHash } = entry;
      const [source] = await tx.select().from(manualSourceKeys).where(and(eq(manualSourceKeys.workspaceId, workspaceId), eq(manualSourceKeys.projectId, projectId), eq(manualSourceKeys.sourceKey, sourceKey)));
      if (source && source.payloadHash !== payloadHash) throw new AppError(409, "IMPORT_SOURCE_CONFLICT", "来源ID在预览后已有不同内容，本批已回滚，请核对。");
      const evidence: EvidenceRecord = { id: randomUUID(), workspaceId, projectId, runId: null, questionId: entry.questionId, questionVersion: input.questionVersion, projectVersion: input.projectVersion,
        questionText: row.questionText, questionGroup: entry.group, sourceSampleId: row.sourceId, sourceSampleKey: "manual-v1:" + payloadHash,
        sourceType: "manual_import", channelId: `manual:${row.platform}:${row.surface}`, platform: row.platform, surface: row.surface, isSynthetic: row.isSynthetic,
        period: input.period, collectedAt: row.collectedAt ? new Date(row.collectedAt).toISOString() : null, importedAt: now.toISOString(), status: row.status, answerText: row.answerText,
        isValid: row.status === "success" && !!row.answerText?.trim() && !!row.collectedAt && row.surface !== "unknown" && Object.values(row.capture).every(Boolean),
        capture: { ...row.capture, platformVerified: row.capture.platformVerified && row.surface !== "unknown" }, citations: row.citations, sourceCandidates: row.sourceCandidates,
        config: { region: row.conditions.region, language: row.conditions.language, search_mode: row.conditions.searchMode }, providerTaskId: null, siteVersion: row.siteVersion, releaseVersion: null,
        cost: { currency: "CNY", estimated: null, reserved: null, actual: null, state: "manual_import_no_platform_charge" }, rawFixture: null,
        questionSourceVersion: "manual-confirmed", factSourceVersion: `project-v${input.projectVersion}`, samplingConfigVersion: "manual-v1:" + importFingerprint(row.conditions), samplingModel: row.conditions.model,
        manualProvenance: { batchId, sourceId: row.sourceId, sourceUrl: row.sourceUrl, sourceAvailability: "not_checked", collectedBy: row.collectedBy, importedBy: actorId, notes: row.notes } };
      const inserted = await tx.insert(answerEvidence).values({ id: evidence.id, workspaceId, projectId, sourceSampleKey: evidence.sourceSampleKey, snapshot: evidence, createdAt: now }).onConflictDoNothing().returning({ id: answerEvidence.id });
      const [stored] = await tx.select({ id: answerEvidence.id }).from(answerEvidence).where(and(eq(answerEvidence.workspaceId, workspaceId), eq(answerEvidence.projectId, projectId), eq(answerEvidence.sourceSampleKey, evidence.sourceSampleKey)));
      if (inserted.length) created++; else duplicates++;
      evidenceIds.push(stored.id);
      await tx.insert(manualSourceKeys).values({ id: randomUUID(), workspaceId, projectId, sourceKey, payloadHash, evidenceId: stored.id }).onConflictDoNothing();
    }
    const batch: ManualImportBatch = { id: batchId, workspaceId, projectId, projectVersion: input.projectVersion, questionVersion: input.questionVersion, period: input.period,
      filename: input.filename, format: input.format, fingerprint: preview.fingerprint, total: prepared.length, created, duplicates, valid: preview.valid, incomplete: preview.incomplete,
      evidenceIds: [...new Set(evidenceIds)], importedBy: actorId, importedAt: now.toISOString(), sourceType: "manual_import", isSynthetic: project.isSynthetic };
    await tx.insert(manualImportBatches).values({ id: batchId, workspaceId, projectId, requestId: confirmation.requestId, fingerprint: preview.fingerprint, snapshot: batch, rawContent: input.content, createdAt: now });
    return batch;
  });
}
