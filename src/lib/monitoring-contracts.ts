export type MonitoringState = "active" | "paused" | "cancelled";
export type MonitoringPurpose = "baseline" | "focus" | "full" | "review-1" | "review-2";
export type OccurrenceState = "planned" | "dispatched" | "missed" | "paused" | "cancelled" | "blocked";

export interface MonitoringOccurrence {
  id: string;
  planId: string;
  projectId: string;
  workspaceId: string;
  purpose: MonitoringPurpose;
  scheduledAt: string;
  plannedLocalDate: string;
  state: OccurrenceState;
  runId: string | null;
  dispatchedAt: string | null;
  reason: string | null;
}

export interface MonitoringPlan {
  id: string;
  workspaceId: string;
  projectId: string;
  revision: number;
  state: MonitoringState;
  timezone: string;
  projectVersion: number;
  questionVersion: number;
  pageCollectionVersion: number;
  questionIds: string[];
  focusQuestionIds: string[];
  repeatsPerDay: number;
  mode: "synthetic_fixture" | "real_domestic";
  channelConfigVersion: string;
  firstBaselineDate: string;
  isSynthetic: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface CoverageCount {
  planned: number;
  valid: number;
  failed: number;
  missing: number;
  unknown: number;
}

export interface BaselineCoverage {
  status: "collecting" | "complete" | "not_comparable";
  actualDates: string[];
  counts: CoverageCount;
  reasons: string[];
  isSynthetic: boolean;
}
