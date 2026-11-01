export type ModificationTaskType = "addition" | "rewrite" | "deletion" | "correction" | "access_repair" | "third_party_correction" | "missing_facts";
export type TaskState = "needs_material" | "awaiting_approval" | "awaiting_publication" | "waiting_external" | "awaiting_verification" | "verified_pending_review" | "synthetic_verified_pending_review" | "reviewed" | "synthetic_reviewed" | "cancelled";
export type VerificationCondition =
  | { kind: "text_present" | "text_absent" | "readable_body"; text: string }
  | { kind: "http_status"; equals: number }
  | { kind: "robots_allows"; path: string }
  | { kind: "no_noindex" | "public_third_party_page_changed" | "customer_confirmed_material_required" };

export interface TaskPageSnapshot {
  id: string;
  url: string;
  source: "live_public" | "synthetic_fixture" | "operator_artifact";
  isSynthetic: boolean;
  executedAt: string;
  observedAt: string;
  httpStatus: number | null;
  bodyComplete: boolean;
  text: string | null;
  rawBody: string | null;
  bodySha256: string | null;
  noindex: boolean | null;
  robotsAllows: boolean | null;
  error: string | null;
}
export interface TaskApproval {
  id: string;
  draftVersion: number;
  projectVersion: number;
  approvedAt: string;
  actorId: string;
  approvedText: string | null;
  conditions: VerificationCondition[];
  isSynthetic: boolean;
}
export interface TaskVerification {
  id: string;
  releaseId: string;
  executedAt: string;
  observedAt: string;
  source: "live_public" | "synthetic_fixture" | "independent_manual";
  isSynthetic: boolean;
  actorId: string;
  method: string;
  reason: string | null;
  checks: { index: number; condition: VerificationCondition; result: "passed" | "failed" | "unknown"; reason: string }[];
  allPassed: boolean;
  beforeSnapshot: TaskPageSnapshot | null;
  afterSnapshot: TaskPageSnapshot | null;
  independentEvidence: string[];
}
export interface TaskRelease {
  id: string;
  taskId: string;
  projectId: string;
  taskRevision: number;
  approvalId: string;
  releaseVersion: number;
  declaredPublishedAt: string;
  createdAt: string;
  firstAllConditionsPassedAt: string | null;
  syntheticAllConditionsPassedAt: string | null;
  isSynthetic: boolean;
  verificationSource: "live_public" | "synthetic_fixture" | "independent_manual" | null;
  superseded: boolean;
  latestVerificationId: string | null;
  requiredForComparison: boolean;
  projectVersion: number;
  affectedQuestionIds: string[];
  reviewReportIds: string[];
}
export interface ModificationTask {
  id: string;
  workspaceId: string;
  projectId: string;
  revision: number;
  draftVersion: number;
  title: string;
  type: ModificationTaskType;
  category: "access" | "content_facts" | "cited_source";
  priority: "high" | "normal";
  state: TaskState;
  targetUrl: string;
  position: string;
  proposedText: string | null;
  conditions: VerificationCondition[];
  evidence: { id: string; kind: "answer" | "fixture_page"; quote: string | null }[];
  factIds: string[];
  missingFactIds: string[];
  affectedQuestionIds: string[];
  hypothesis: string;
  requiredForComparison: boolean;
  isSynthetic: boolean;
  origin: "synthetic_template" | "analysis_diagnosis";
  fixtureTaskId: string | null;
  basis: { projectVersion: number; analysisIds: string[]; analysisVersion: string; questionVersion: number | null; promptVersion: string; model: string };
  basisStale: boolean;
  beforeSnapshot: TaskPageSnapshot | null;
  currentApprovalId: string | null;
  approvals: TaskApproval[];
  releases: TaskRelease[];
  verifications: TaskVerification[];
  createdAt: string;
  updatedAt: string;
  actorId: string;
  cancelReason: string | null;
}

export interface TaskCollection {
  tasks: ModificationTask[];
  canManuallyVerify: boolean;
  mode: "synthetic_preview" | "live";
  fixtureSnapshots: { id: string; url: string; observedAt: string }[];
}
