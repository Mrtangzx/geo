import type { Project } from "./contracts";
import type { EvidenceAttachment, ManualProvenance } from "./import-contracts";

export const recommendationKinds = ["recommended", "mentioned", "not_mentioned", "not_recommended", "unknown"] as const;
export type RecommendationKind = typeof recommendationKinds[number];
export type FactVerdict = "consistent" | "conflict" | "unknown";
export type AnalysisMode = "synthetic_reference" | "manual_review" | "model";
export type AnalysisStatus = "succeeded" | "failed" | "pending_configuration" | "pending_reconciliation";

export interface AnalysisEvidence {
  id: string; workspaceId: string; projectId: string; batchId: string | null;
  sourceSampleId: string | null; sourceKey: string;
  sourceType: string; channelId: string; platform: string; isSynthetic: boolean;
  period: string; group: string; questionId: string; questionText: string;
  questionVersion: string; projectVersion: number; factVersion: string;
  configVersion: string; region: string | null; language: string | null; searchMode: string | null;
  samplingModel: string | null; siteVersion: string | null; releaseVersion: string | null;
  collectedAt: string | null; status: string; answerText: string | null;
  capture: { questionVerified: boolean; platformVerified: boolean; answerComplete: boolean; timeVerified: boolean };
  citations: { status: string; bodyMappings: { url: string; quote: string }[] | null };
  sourceCandidates: { url: string; kind?: string }[];
  manualProvenance?: ManualProvenance; attachments?: EvidenceAttachment[];
}

export interface AnalysisFactClaim {
  factId: string; quote: string; verdict: FactVerdict; reason: string;
}
export interface AnalysisLabels {
  recommendation: RecommendationKind;
  recommendationQuote: string;
  recommendationUnknownReason: string | null;
  factClaims: AnalysisFactClaim[];
  questionSuggestions: { text: string; sourceEvidenceIds: string[]; reason: string }[];
}

export interface EvidenceAnalysis {
  id: string; projectId: string; workspaceId: string; evidenceId: string;
  revision: number; supersedesId: string | null; status: AnalysisStatus; mode: AnalysisMode;
  actorId: string; createdAt: string; reason: string;
  requestedModel: string | null; returnedModel: string | null;
  promptVersion: string; schemaVersion: string; referenceVersion: string | null;
  projectVersion: number; projectSnapshot: Project; evidenceSnapshot: AnalysisEvidence;
  labels: AnalysisLabels | null;
  error: { code: string; message: string } | null;
}

export interface ActionableDiagnosis {
  id: string; projectId: string; workspaceId: string; analysisId: string;
  evidenceId: string; analysisRevision: number; projectVersion: number;
  questionId: string; questionVersion: string; isSynthetic: boolean;
  kind: "answer_fact_conflict" | "missing_fact_material";
  quote: string; factId: string; factStatement: string;
  reason: string; suggestedText: string | null; targetUrls: string[];
  requiresPageReview: boolean; requiresFacts: boolean;
}

export interface MetricRate { numerator: number; denominator: number | null; percent: number | null }
export interface MetricsScope {
  sourceType: string; platform: string; channelId: string; isSynthetic: boolean;
  period: string; group: string; questionVersion: string; projectVersion: number;
  factVersion: string; configVersion: string; region: string | null;
  language: string | null; searchMode: string | null; samplingModel: string | null;
}
export interface EvidenceMetricReference {
  evidenceId: string; sourceSampleId: string | null; analysisId: string | null;
  analysisRevision: number | null; analysisMode: AnalysisMode | null;
  valid: boolean; excludedReason: string | null;
  citationComplete: boolean; officialCitation: boolean | null;
}
export interface MetricsGroup {
  scope: MetricsScope;
  observed: number; planned: number | null; valid: number; failed: number; incomplete: number; pending: number;
  missing: number | null; duplicate: number; unanalysed: number; analysisFailed: number; planningComplete: boolean;
  recommendationCounts: Record<RecommendationKind, number>;
  factCounts: Record<FactVerdict, number>;
  validCoverage: MetricRate; recommendation: MetricRate; recommendationCoverage: MetricRate;
  facts: MetricRate; factCoverage: MetricRate; officialCitation: MetricRate; citationCoverage: MetricRate;
  references: EvidenceMetricReference[];
}
export interface MetricsSnapshot {
  id: string; projectId: string; workspaceId: string; createdAt: string; actorId: string;
  calculationVersion: "metrics-v1";
  groups: MetricsGroup[];
  overallByScope: MetricsGroup[];
  unassignedPlans: { runId: string; planned: number; observed: number; missing: number; status: string }[];
  notes: string[];
}

export interface AnalysisOverview {
  evidence: AnalysisEvidence[];
  analyses: EvidenceAnalysis[];
  latestMetrics: MetricsSnapshot | null;
  modelStatus: { configured: boolean; requestedModel: string; paidCallsEnabled: false; message: string };
}
