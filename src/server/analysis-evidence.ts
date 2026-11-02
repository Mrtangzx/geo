import type { EvidenceRecord } from "@/lib/sampling-contracts";
import type { AnalysisEvidence } from "@/lib/analysis-contracts";

export function normalizeAnalysisEvidence(record: EvidenceRecord): AnalysisEvidence {
  const raw = record.rawFixture;
  return {
    id: record.id, workspaceId: record.workspaceId, projectId: record.projectId, batchId: record.runId,
    sourceSampleId: record.sourceSampleId, sourceKey: record.sourceSampleKey,
    sourceType: record.sourceType, channelId: record.channelId, platform: record.platform,
    isSynthetic: record.isSynthetic, period: record.period,
    group: record.questionGroup ?? raw?.group ?? "unknown", questionId: record.questionId ?? raw?.question_id ?? "unknown",
    questionText: record.questionText, questionVersion: `${record.questionVersion}:${record.questionSourceVersion ?? raw?.question_version ?? "unknown"}`,
    projectVersion: record.projectVersion, factVersion: record.factSourceVersion ?? raw?.fact_version ?? "unknown",
    configVersion: record.samplingConfigVersion ?? raw?.config_version ?? "unknown", region: record.config.region ?? null,
    language: record.config.language ?? null, searchMode: record.config.search_mode ?? null,
    samplingModel: record.samplingModel ?? (typeof raw?.returned_model === "string" ? raw.returned_model : null),
    siteVersion: record.siteVersion, releaseVersion: record.releaseVersion,
    collectedAt: record.collectedAt, status: record.status, answerText: record.answerText,
    capture: record.capture, citations: record.citations, sourceCandidates: record.sourceCandidates,
    manualProvenance: record.manualProvenance, attachments: record.attachments ?? [],
  };
}
