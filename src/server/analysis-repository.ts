import { randomUUID } from "node:crypto";
import { and, desc, eq, max } from "drizzle-orm";
import { ZodError } from "zod";
import { getDatabase } from "@/db/client";
import { projects, projectVersions } from "@/db/schema";
import { evidenceAnalyses } from "@/db/analysis-schema";
import type { Project } from "@/lib/contracts";
import type { ActionableDiagnosis, AnalysisEvidence, AnalysisLabels, AnalysisMode, EvidenceAnalysis } from "@/lib/analysis-contracts";
import { getProject } from "./projects";
import { getEvidence, listEvidence } from "./sampling";
import { getFixtureSeed } from "./synthetic-fixtures";
import { normalizeAnalysisEvidence } from "./analysis-evidence";
import { AppError } from "./errors";
import { evidenceExclusion, validateAnalysisLabels } from "./analysis-validation";
import { syntheticReferenceLabels } from "./analysis-reference";
import { ANALYSIS_PROMPT_VERSION, ANALYSIS_SCHEMA_VERSION, buildQwenAnalysisRequest, getAnalysisModelStatus } from "./analysis-model";

export async function getAnalysisProjectVersion(workspaceId: string, projectId: string, version: number): Promise<Project> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: projectVersions.snapshot }).from(projectVersions)
    .where(and(eq(projectVersions.workspaceId, workspaceId), eq(projectVersions.projectId, projectId), eq(projectVersions.version, version))).limit(1);
  if (!row) throw new AppError(404, "ANALYSIS_PROJECT_VERSION_MISSING", "未找到证据绑定的企业资料版本。");
  return row.snapshot;
}

export async function listLatestAnalyses(workspaceId: string, projectId: string): Promise<EvidenceAnalysis[]> {
  await getProject(workspaceId, projectId);
  const rows = await getDatabase().selectDistinctOn([evidenceAnalyses.evidenceId], { snapshot: evidenceAnalyses.snapshot }).from(evidenceAnalyses)
    .where(and(eq(evidenceAnalyses.workspaceId, workspaceId), eq(evidenceAnalyses.projectId, projectId)))
    .orderBy(evidenceAnalyses.evidenceId, desc(evidenceAnalyses.revision));
  return rows.map((row) => row.snapshot);
}

export async function getEvidenceAnalysis(workspaceId: string, projectId: string, analysisId: string): Promise<EvidenceAnalysis> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: evidenceAnalyses.snapshot }).from(evidenceAnalyses)
    .where(and(eq(evidenceAnalyses.id, analysisId), eq(evidenceAnalyses.workspaceId, workspaceId), eq(evidenceAnalyses.projectId, projectId))).limit(1);
  if (!row) throw new AppError(404, "ANALYSIS_NOT_FOUND", "未找到该分析版本。");
  return row.snapshot;
}

export async function listAnalysisVersions(workspaceId: string, projectId: string, evidenceId: string): Promise<EvidenceAnalysis[]> {
  await getEvidence(workspaceId, projectId, evidenceId);
  const rows = await getDatabase().select({ snapshot: evidenceAnalyses.snapshot }).from(evidenceAnalyses)
    .where(and(eq(evidenceAnalyses.workspaceId, workspaceId), eq(evidenceAnalyses.projectId, projectId), eq(evidenceAnalyses.evidenceId, evidenceId)))
    .orderBy(desc(evidenceAnalyses.revision));
  return rows.map((row) => row.snapshot);
}

export async function getAnalysisEvidenceBundle(workspaceId: string, projectId: string, evidenceId: string) {
  const evidence = normalizeAnalysisEvidence(await getEvidence(workspaceId, projectId, evidenceId));
  return { evidence, projectSnapshot: await getAnalysisProjectVersion(workspaceId, projectId, evidence.projectVersion), analyses: await listAnalysisVersions(workspaceId, projectId, evidenceId) };
}

export async function createEvidenceAnalysis(
  workspaceId: string, projectId: string, actorId: string, evidenceId: string,
  input: { mode: AnalysisMode; expectedRevision: number; reason?: string; confirmSyntheticReference?: boolean; labels?: unknown },
): Promise<EvidenceAnalysis> {
  const evidence = normalizeAnalysisEvidence(await getEvidence(workspaceId, projectId, evidenceId));
  const project = await getAnalysisProjectVersion(workspaceId, projectId, evidence.projectVersion);
  if (input.mode === "synthetic_reference" && !input.confirmSyntheticReference) throw new AppError(400, "REFERENCE_CONFIRMATION_REQUIRED", "请明确确认使用合成参考标注，结果不是模型输出。");
  if (input.mode === "manual_review" && !input.reason?.trim()) throw new AppError(400, "REVIEW_REASON_REQUIRED", "人工复核必须记录理由。");
  let labels: AnalysisLabels | null = null;
  let status: EvidenceAnalysis["status"] = "succeeded";
  let referenceVersion: string | null = null;
  let error: EvidenceAnalysis["error"] = null;
  let requestedModel: string | null = null;
  try {
    const incomplete = evidenceExclusion(evidence);
    if (incomplete) throw new AppError(400, "EVIDENCE_INCOMPLETE", incomplete);
    if (input.mode === "model") {
      requestedModel = buildQwenAnalysisRequest(evidence, project).model;
      const readiness = getAnalysisModelStatus();
      status = "pending_configuration";
      error = { code: readiness.configured ? "REAL_ANALYSIS_NOT_AUTHORIZED" : "ANALYSIS_MODEL_NOT_CONFIGURED", message: readiness.message };
    } else {
      let proposed = input.labels;
      if (input.mode === "synthetic_reference") {
        const reference = await syntheticReferenceLabels(evidence, project, await getFixtureSeed(workspaceId, projectId));
        referenceVersion = reference.referenceVersion;
        proposed = reference.labels;
      }
      labels = validateAnalysisLabels(proposed, evidence, project);
    }
  } catch (failure) {
    status = "failed";
    error = failure instanceof AppError ? { code: failure.code, message: failure.message }
      : failure instanceof ZodError ? { code: "ANALYSIS_SCHEMA_INVALID", message: failure.issues.map((issue) => issue.message).join("；") }
        : { code: "ANALYSIS_REFERENCE_UNAVAILABLE", message: "分析或参考资料未就绪，原始回答已保留，可核对后重试。" };
  }
  return getDatabase().transaction(async (tx) => {
    const [owned] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    if (!owned) throw new AppError(404, "PROJECT_NOT_FOUND", "未找到该品牌项目。");
    const [{ highest }] = await tx.select({ highest: max(evidenceAnalyses.revision) }).from(evidenceAnalyses)
      .where(and(eq(evidenceAnalyses.workspaceId, workspaceId), eq(evidenceAnalyses.projectId, projectId), eq(evidenceAnalyses.evidenceId, evidenceId)));
    if ((highest ?? 0) !== input.expectedRevision) throw new AppError(409, "ANALYSIS_REVISION_CONFLICT", "分析已被更新，当前复核未覆盖旧版本，请重新读取。");
    const [previous] = await tx.select({ id: evidenceAnalyses.id }).from(evidenceAnalyses).where(and(eq(evidenceAnalyses.evidenceId, evidenceId), eq(evidenceAnalyses.workspaceId, workspaceId), eq(evidenceAnalyses.projectId, projectId))).orderBy(desc(evidenceAnalyses.revision)).limit(1);
    const now = new Date();
    const analysis: EvidenceAnalysis = {
      id: randomUUID(), projectId, workspaceId, evidenceId, revision: (highest ?? 0) + 1,
      supersedesId: previous?.id ?? null, status, mode: input.mode, actorId, createdAt: now.toISOString(),
      reason: input.reason?.trim() || (input.mode === "synthetic_reference" ? "用户显式选择合成参考标注回放；非模型输出" : "检查真实模型配置；本阶段没有发起付费请求"),
      requestedModel, returnedModel: null, promptVersion: ANALYSIS_PROMPT_VERSION, schemaVersion: ANALYSIS_SCHEMA_VERSION,
      referenceVersion, projectVersion: evidence.projectVersion, projectSnapshot: project, evidenceSnapshot: evidence, labels, error,
    };
    await tx.insert(evidenceAnalyses).values({ id: analysis.id, projectId, workspaceId, evidenceId, revision: analysis.revision, status, mode: analysis.mode, snapshot: analysis, createdAt: now });
    return analysis;
  });
}

export async function replaySyntheticAnalyses(workspaceId: string, projectId: string, actorId: string) {
  const rows = await listEvidence(workspaceId, projectId);
  const current = new Map((await listLatestAnalyses(workspaceId, projectId)).map((item) => [item.evidenceId, item]));
  const results: EvidenceAnalysis[] = [];
  let skipped = 0;
  for (const record of rows) {
    const previous = current.get(record.id);
    if (previous?.status === "succeeded") { skipped += 1; continue; }
    if (!record.isSynthetic || record.sourceType !== "manual_import") { skipped += 1; continue; }
    results.push(await createEvidenceAnalysis(workspaceId, projectId, actorId, record.id, { mode: "synthetic_reference", expectedRevision: previous?.revision ?? 0, confirmSyntheticReference: true }));
  }
  return { created: results.length, skipped, succeeded: results.filter((item) => item.status === "succeeded").length, failed: results.filter((item) => item.status !== "succeeded").length, analyses: results };
}

export async function listActionableDiagnoses(workspaceId: string, projectId: string): Promise<ActionableDiagnosis[]> {
  const analyses = await listLatestAnalyses(workspaceId, projectId);
  return analyses.flatMap((analysis) => {
    if (analysis.status !== "succeeded" || !analysis.labels) return [];
    return analysis.labels.factClaims.flatMap((claim, index) => {
      if (claim.verdict === "consistent") return [];
      const fact = analysis.projectSnapshot.facts.find((item) => item.id === claim.factId);
      if (!fact) return [];
      const needsFacts = fact.status !== "confirmed" || claim.verdict === "unknown";
      const citations = analysis.evidenceSnapshot.citations.bodyMappings ?? [];
      const targetUrls = [...new Set(citations.map((item) => item.url))];
      return [{
        id: `${analysis.id}:${index}`, projectId, workspaceId, analysisId: analysis.id, evidenceId: analysis.evidenceId,
        analysisRevision: analysis.revision, projectVersion: analysis.projectVersion, questionId: analysis.evidenceSnapshot.questionId,
        questionVersion: analysis.evidenceSnapshot.questionVersion, isSynthetic: analysis.evidenceSnapshot.isSynthetic,
        kind: needsFacts ? "missing_fact_material" as const : "answer_fact_conflict" as const,
        quote: claim.quote, factId: fact.id, factStatement: fact.statement, reason: claim.reason,
        suggestedText: needsFacts ? null : fact.statement, targetUrls: targetUrls.length ? targetUrls : [analysis.projectSnapshot.websiteUrl],
        requiresPageReview: true, requiresFacts: needsFacts,
      }];
    });
  });
}

export async function listNormalizedAnalysisEvidence(workspaceId: string, projectId: string): Promise<AnalysisEvidence[]> {
  return (await listEvidence(workspaceId, projectId)).map(normalizeAnalysisEvidence);
}
