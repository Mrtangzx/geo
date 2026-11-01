import type { QuestionGroup } from "./question-contracts";

export type FixturePeriod = "baseline" | "review-1" | "review-2" | "edge";
export type SamplingRunMode = "synthetic_fixture" | "synthetic_operations" | "real_domestic";
export type SamplingRunStatus = "queued" | "running" | "completed" | "partial" | "failed" | "needs_reconciliation" | "paused" | "cancelled";
export type BudgetKind = "real" | "simulation";
export type Currency = "CNY" | "USD";

export interface RawFixtureEvidence {
  sample_id: string; source_sample_key: string; workspace_id: string; brand_id: string;
  brand_version: string; fact_version: string; question_id: string; question_version: string;
  question_text: string; group: string; period: string; source_type: string;
  channel_id: string; platform: string; surface: string; is_synthetic: boolean;
  config_version: string; config: Record<string, string | null>;
  site_version: string; release_version: string | null; collected_at: string | null;
  status: string; answer_text: string | null;
  capture: { question_verified: boolean; platform_verified: boolean; answer_complete: boolean; time_verified: boolean };
  citations: { status: string; body_mappings: { quote: string; url: string }[] | null };
  source_candidates: { url: string; kind?: string }[];
  provider_task_id: string | null;
  cost: { currency: string; estimated: string | null; reserved: string | null; actual: string | null; state: string };
  [key: string]: unknown;
}

export interface EvidenceRecord {
  id: string; workspaceId: string; projectId: string; runId: string;
  questionId: string | null; questionVersion: number; questionText: string; questionGroup: QuestionGroup | null;
  projectVersion: number; sourceSampleId: string; sourceSampleKey: string;
  sourceType: string; channelId: string; platform: string; surface: string; isSynthetic: boolean;
  period: FixturePeriod; collectedAt: string | null; importedAt: string;
  status: string; answerText: string | null; isValid: boolean;
  capture: { questionVerified: boolean; platformVerified: boolean; answerComplete: boolean; timeVerified: boolean };
  citations: { status: string; bodyMappings: { quote: string; url: string }[] | null };
  sourceCandidates: { url: string; kind?: string }[];
  config: Record<string, string | null>; providerTaskId: string | null;
  siteVersion: string; releaseVersion: string | null;
  cost: RawFixtureEvidence["cost"];
  rawFixture: RawFixtureEvidence;
}

export interface FixtureSeed {
  manifestId: "geo-r2-v1"; workspaceId: string; projectId: string;
  projectVersion: number; questionVersion: number;
  questionIds: Record<string, string>; factIds: Record<string, string>;
  fixtureBrandVersion: string; fixtureFactVersion: string; fixtureQuestionVersion: string;
  createdAt: string; createdBy: string;
}

export interface CreateRunInput {
  mode: SamplingRunMode; period: FixturePeriod; questionVersion: number;
  projectVersion?: number; siteVersion?: string; channelConfigVersion?: string;
  executionKey?: string; batchKey?: string; purposes?: string[];
  newBatchConfirmed?: boolean;
  questionIds?: string[]; repeatsPerDay?: 1 | 2 | 3; requestedCollectionDate?: string;
  samplingConditions?: { channel: string | null; platform: string | null; model: string | null; region: string | null; language: string | null; search: string | null };
  operationScenario?: "normal" | "unknown_submission" | "retryable_not_accepted";
}

export interface SamplingRun {
  id: string; workspaceId: string; projectId: string; mode: SamplingRunMode; period: FixturePeriod;
  questionVersion: number; projectVersion: number; siteVersion: string | null; channelConfigVersion: string;
  executionKey: string; purposes: string[]; status: SamplingRunStatus;
  questionIds?: string[]; repeatsPerDay?: 1 | 2 | 3; requestedCollectionDate?: string | null;
  samplingConditions?: CreateRunInput["samplingConditions"];
  plannedCount: number; importedCount: number; validCount: number; failedCount: number; excludedCount: number;
  exclusions: { sourceSampleId: string; reason: string }[];
  jobId: string | null; reservationId: string | null; providerTaskId: string | null;
  submissionAttempts: number; operationScenario: "normal" | "unknown_submission" | "retryable_not_accepted";
  isSynthetic: boolean; createdAt: string; startedAt: string | null; completedAt: string | null;
  error: string | null; createdBy: string;
}

export interface BudgetAccount {
  workspaceId: string; kind: BudgetKind; currency: Currency;
  limitMinor: number; reservedMinor: number; spentMinor: number; availableMinor: number;
  version: number; updatedAt: string | null;
}

export interface BudgetReservation {
  id: string; workspaceId: string; projectId: string; kind: BudgetKind; currency: Currency;
  action: "sampling" | "analysis"; executionKey: string;
  upperBoundMinor: number; actualMinor: number | null;
  status: "reserved" | "settled" | "released" | "needs_reconciliation";
  reason: string | null; createdAt: string; updatedAt: string;
}

export interface BudgetReservationInput {
  workspaceId: string; projectId: string; kind: BudgetKind; currency: Currency;
  action: "sampling" | "analysis"; executionKey: string; upperBoundMinor: number;
}

export interface SamplingUnit {
  id: string; workspaceId: string; projectId: string; businessKey: string;
  questionId: string | null; questionVersion: number; projectVersion: number;
  mode: SamplingRunMode; period: FixturePeriod; sourceSampleKey: string;
  status: "queued" | "processing" | "completed" | "needs_reconciliation" | "failed" | "cancelled";
  evidenceId: string | null; reservationId: string | null; providerTaskId: string | null;
  submissionAttempts: number; operationScenario: SamplingRun["operationScenario"];
  submissionState?: "unknown" | "not_accepted";
  createdAt: string; updatedAt: string; retryAfterAt: string | null; error: string | null;
}
