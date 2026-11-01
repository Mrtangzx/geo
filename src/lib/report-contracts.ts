import type { AnalysisEvidence, EvidenceAnalysis, MetricsGroup, MetricsSnapshot } from "./analysis-contracts";
import type { Project } from "./contracts";
import type { MonitoringPlan } from "./monitoring-contracts";
import type { ModificationTask } from "./task-contracts";

export interface ReportWindow {
  releaseId: string;
  taskId: string;
  releaseVersion: number;
  verifiedAt: string | null;
  isSynthetic: boolean;
  superseded: boolean;
  firstDates: string[];
  secondDates: string[];
  state: "awaiting_verification" | "observing" | "window_elapsed" | "synthetic_observation" | "superseded";
}

export interface ReportComparison {
  id: string;
  period: string;
  sourceType: string;
  platform: string;
  channelId: string;
  group: string;
  isSynthetic: boolean;
  status: "comparable" | "observations_only";
  questionIntersection: string[];
  exclusions: { questionId: string; reason: string }[];
  baseline: MetricsGroup | null;
  review: MetricsGroup | null;
  changes: { metric: "recommendation" | "facts" | "officialCitation"; baseline: number | null; review: number | null; percentagePoints: number | null }[];
  baselineDates: string[];
  reviewDates: string[];
  limitations: string[];
  nextActions: string[];
}

export interface ReviewReport {
  id: string;
  workspaceId: string;
  projectId: string;
  version: number;
  supersedesId: string | null;
  createdAt: string;
  actorId: string;
  calculationVersion: "report-v1";
  timezone: string;
  projectSnapshot: Project;
  metricsSnapshot: MetricsSnapshot;
  evidence: AnalysisEvidence[];
  analyses: EvidenceAnalysis[];
  tasks: ModificationTask[];
  monitoringPlans: MonitoringPlan[];
  windows: ReportWindow[];
  comparisons: ReportComparison[];
  notes: string[];
}

export interface ReportSummary {
  id: string; version: number; createdAt: string; metricsSnapshotId: string;
  isSynthetic: boolean; comparisonCount: number; comparableCount: number;
}
