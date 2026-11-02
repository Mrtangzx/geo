/** Server adapters normalize provider data before it enters the evidence store. */
export type ExternalChannel = "dataforseo_chatgpt_web" | "qwen_search_api" | "qwen_analysis";
export type ExternalSourceType = "consumer_web" | "api_comparison" | "analysis_model";

export interface ChannelReadiness {
  channel: ExternalChannel;
  sourceType: ExternalSourceType;
  configured: boolean;
  paidCallsEnabled: boolean;
  acceptance: "not_verified";
  missing: string[];
  requestedModel: string | null;
  currency: "CNY" | "USD";
  upperBoundMinor: number | null;
  priceReference: string | null;
}

export interface ExternalCitation {
  url: string;
  quote: string;
}

export interface ExternalAnswer {
  sourceType: "consumer_web" | "api_comparison";
  channelId: "dataforseo_chatgpt_web" | "qwen_search_api";
  platform: "chatgpt" | "qwen";
  surface: "web" | "api";
  question: string | null;
  questionMatches: boolean;
  answerText: string | null;
  answerComplete: boolean;
  requestedModel: string | null;
  returnedModel: string | null;
  collectedAt: string | null;
  collectedAtSource: "provider" | "response_receipt" | "unknown";
  providerTaskId: string | null;
  providerRequestId: string | null;
  conditions: {
    region: string | null;
    language: string | null;
    searchRequested: boolean;
    searchObserved: boolean | null;
  };
  citations: { status: "complete" | "unknown"; bodyMappings: ExternalCitation[] | null };
  sourceCandidates: { url: string; kind: "search_result" | "provider_source_list" }[];
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  warnings: string[];
}

export interface ProviderRequestBody {
  url: string;
  method: "POST" | "GET";
  body: unknown;
}

export type ProviderSubmission =
  | { state: "accepted"; providerTaskId: string; actualCostUsd: string | null }
  | { state: "not_accepted"; providerTaskId: null; actualCostUsd: "0"; reason: string }
  | { state: "unknown"; providerTaskId: string | null; actualCostUsd: string | null; reason: string };

export type ProviderQuery =
  | { state: "pending"; providerTaskId: string }
  | { state: "complete"; providerTaskId: string; answer: ExternalAnswer }
  | { state: "unavailable"; providerTaskId: string; reason: string };

/** Durable intent MUST precede POST. A recovered intent is query/reconcile-only. */
export interface ExternalExecutionIntent {
  id: string;
  workspaceId: string;
  projectId: string;
  channel: ExternalChannel;
  businessKey: string;
  reservationId: string;
  requestFingerprint: string;
  state: "reserved" | "submission_intent" | "accepted" | "complete" | "not_accepted" | "needs_reconciliation";
  providerTaskId: string | null;
  providerRequestId: string | null;
  submissionAttempts: number;
  submittedAt: string | null;
  completedAt: string | null;
}
