import { z } from "zod";
import type { Project } from "@/lib/contracts";
import type { AnalysisEvidence, AnalysisLabels } from "@/lib/analysis-contracts";
import { recommendationKinds } from "@/lib/analysis-contracts";
import { AppError } from "./errors";

export const analysisLabelsSchema = z.object({
  recommendation: z.enum(recommendationKinds),
  recommendationQuote: z.string().trim().min(1, "推荐判断必须关联回答原文片段。").max(12000),
  recommendationUnknownReason: z.string().trim().max(2000).nullable(),
  factClaims: z.array(z.object({
    factId: z.string().min(1).max(200), quote: z.string().trim().min(1).max(12000),
    verdict: z.enum(["consistent", "conflict", "unknown"]), reason: z.string().trim().min(1).max(2000),
  }).strict()).max(200),
  questionSuggestions: z.array(z.object({ text: z.string().trim().min(1).max(2000), sourceEvidenceIds: z.array(z.string().uuid()).min(1).max(10), reason: z.string().trim().min(1).max(2000) }).strict()).max(20),
}).strict();

export const analysisRequestSchema = z.object({
  mode: z.enum(["synthetic_reference", "manual_review", "model"]),
  expectedRevision: z.number().int().min(0), reason: z.string().trim().max(3000).default(""),
  confirmSyntheticReference: z.boolean().optional(), labels: z.unknown().optional(),
}).strict();

export const referenceReplaySchema = z.object({ confirmSyntheticReference: z.literal(true) }).strict();
export const analysisIdSchema = z.string().uuid("分析标识无效。");
export const evidenceIdSchema = z.string().uuid("证据标识无效。");

export function evidenceExclusion(evidence: AnalysisEvidence): string | null {
  if (evidence.status !== "success") return evidence.status === "pending" || evidence.status === "queued" || evidence.status === "running" ? "采集尚未完成" : "采集失败或结果未知";
  if (!evidence.answerText?.trim()) return "缺少回答全文";
  if (!evidence.collectedAt || !Number.isFinite(Date.parse(evidence.collectedAt))) return "缺少可核对的采集时间";
  if (!evidence.capture.questionVerified || !evidence.questionText.trim()) return "实际问题未核对";
  if (!evidence.capture.platformVerified || !evidence.platform || !evidence.channelId) return "平台或渠道未核对";
  if (!evidence.capture.answerComplete) return "回答截断或未完整采集";
  if (!evidence.capture.timeVerified) return "采集时间未核对";
  return null;
}

export function validateAnalysisLabels(raw: unknown, evidence: AnalysisEvidence, project: Project): AnalysisLabels {
  const labels = analysisLabelsSchema.parse(raw);
  if (evidenceExclusion(evidence)) throw new AppError(400, "EVIDENCE_INCOMPLETE", "证据未完整核对，不能生成确定分析。");
  const answer = evidence.answerText!;
  if (!answer.includes(labels.recommendationQuote)) throw new AppError(400, "ANALYSIS_QUOTE_NOT_FOUND", "推荐判断的片段不存在于回答原文中。");
  if (labels.recommendation === "unknown" && !labels.recommendationUnknownReason) throw new AppError(400, "ANALYSIS_UNKNOWN_REASON_REQUIRED", "无法判断时必须说明原因。");
  const facts = new Map(project.facts.map((fact) => [fact.id, fact]));
  const statements = new Set<string>();
  for (const claim of labels.factClaims) {
    const fact = facts.get(claim.factId);
    if (!fact) throw new AppError(400, "ANALYSIS_FACT_NOT_FOUND", "事实标识不属于证据绑定的企业资料版本。");
    if (!answer.includes(claim.quote)) throw new AppError(400, "ANALYSIS_FACT_QUOTE_NOT_FOUND", "事实判断片段不存在于回答原文中。");
    if (fact.status !== "confirmed" && claim.verdict !== "unknown") throw new AppError(400, "ANALYSIS_UNCONFIRMED_FACT", "待确认资料只能标记资料不足，不能判为一致或冲突。");
    const key = `${claim.factId}\u0000${claim.quote}`;
    if (statements.has(key)) throw new AppError(400, "ANALYSIS_DUPLICATE_CLAIM", "同一业务陈述不能重复计数。");
    statements.add(key);
  }
  for (const suggestion of labels.questionSuggestions) {
    if (suggestion.sourceEvidenceIds.some((id) => id !== evidence.id)) throw new AppError(400, "ANALYSIS_SUGGESTION_EVIDENCE_MISMATCH", "问题建议引用了不属于当前分析的证据。");
  }
  return labels;
}
