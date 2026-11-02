import { z } from "zod";
import type { ExternalAnswer, ProviderRequestBody } from "@/lib/channel-contracts";
import type { AnalysisEvidence } from "@/lib/analysis-contracts";
import type { Project } from "@/lib/contracts";
import { buildQwenAnalysisRequest } from "../analysis-model";
import { dashScopeEndpoint } from "./config";
import { array, integer, object, safeHttpUrl, text, utcTime } from "./parsing";

export const qwenSearchInputSchema = z.object({
  question: z.string().trim().min(1).max(2000), model: z.string().trim().min(1).max(100),
  // Region/language of the API deployment are not the user's product locale.
  region: z.string().trim().min(1).max(120).nullable(), language: z.string().trim().min(1).max(120).nullable(),
  maxOutputTokens: z.number().int().min(128).max(16384),
}).strict();
export type QwenSearchInput = z.infer<typeof qwenSearchInputSchema>;

export function buildQwenSearchRequest(input: QwenSearchInput): ProviderRequestBody {
  const value = qwenSearchInputSchema.parse(input);
  return { url: dashScopeEndpoint(), method: "POST", body: {
    model: value.model, input: { messages: [{ role: "user", content: value.question }] },
    parameters: { result_format: "message", max_tokens: value.maxOutputTokens, enable_search: true,
      search_options: { enable_source: true, enable_citation: true, citation_format: "[ref_<number>]", forced_search: true, search_strategy: "turbo" } },
  } };
}

export function buildDashScopeAnalysisRequest(evidence: AnalysisEvidence, project: Project, maxOutputTokens: number): ProviderRequestBody {
  const tokens = z.number().int().min(128).max(16384).parse(maxOutputTokens);
  const original = buildQwenAnalysisRequest(evidence, project);
  return { url: dashScopeEndpoint(), method: "POST", body: {
    model: original.model, input: { messages: original.messages },
    // Analysis has no tools and explicitly disables search. JSON is requested
    // in the instruction and validated locally, avoiding a silent model switch
    // or an unverified structured-output/thinking combination.
    parameters: { result_format: "message", max_tokens: tokens, enable_search: false },
  } };
}

export interface DashScopeOutput {
  state: "complete" | "failed";
  answerText: string | null;
  answerComplete: boolean;
  requestId: string | null;
  returnedModel: string | null;
  finishReason: string | null;
  usage: ExternalAnswer["usage"];
  errorCode: string | null;
}

export function parseDashScopeOutput(raw: unknown): DashScopeOutput {
  const response = object(raw); const output = object(response.output);
  const choice = object(array(output.choices)[0]); const message = object(choice.message);
  const code = text(response.code);
  const answerText = text(message.content) ?? text(output.text);
  const finishReason = text(choice.finish_reason) ?? text(output.finish_reason);
  const usage = object(response.usage);
  return { state: code || !answerText ? "failed" : "complete", answerText,
    answerComplete: !code && !!answerText && finishReason === "stop", requestId: text(response.request_id),
    // Native API documentation does not guarantee a returned model field. Do
    // not fill this from the requested model and pretend it was verified.
    returnedModel: text(response.model) ?? text(output.model), finishReason,
    usage: { inputTokens: integer(usage.input_tokens), outputTokens: integer(usage.output_tokens), totalTokens: integer(usage.total_tokens) },
    errorCode: code ?? (!answerText ? "EMPTY_MODEL_OUTPUT" : null) };
}

export function parseQwenSearchAnswer(raw: unknown, requested: QwenSearchInput, receivedAt: string): ExternalAnswer {
  const output = parseDashScopeOutput(raw); const response = object(raw);
  const search = object(object(response.output).search_info ?? response.search_info);
  const results = array(search.search_results); const candidates = new Map<string, ExternalAnswer["sourceCandidates"][number]>();
  for (const result of results) {
    const url = safeHttpUrl(object(result).url);
    if (url) candidates.set(url, { url, kind: "search_result" });
  }
  // Citation numbers alone do not identify a safe quote range or prove mapping
  // completeness. Keep raw search_info in the private provider record, and
  // require evidence review before a body citation may enter a denominator.
  const warnings = ["此来源为千问联网API对照，不能替代千问、国内或ChatGPT网页产品。", "搜索来源与正文引用映射分别保存，当前映射完整性未知。"];
  if (!output.returnedModel) warnings.push("实际返回模型字段缺失，不能用请求模型补写。");
  if (!output.answerComplete) warnings.push("回答没有自然结束或采集失败，不能当完整有效回答。");
  if (!Object.keys(search).length) warnings.push("未返回搜索信息，不能仅凭enable_search请求声称已经联网。");
  if (requested.region != null || requested.language != null) warnings.push("输入的地区/语言是采样意图；当前接口未证明网页产品地区或语言控制，归一化条件保持未知。");
  return {
    sourceType: "api_comparison", channelId: "qwen_search_api", platform: "qwen", surface: "api",
    question: requested.question, questionMatches: true, answerText: output.answerText, answerComplete: output.answerComplete,
    requestedModel: requested.model, returnedModel: output.returnedModel, collectedAt: utcTime(receivedAt), collectedAtSource: utcTime(receivedAt) ? "response_receipt" : "unknown",
    providerTaskId: null, providerRequestId: output.requestId,
    conditions: { region: null, language: null, searchRequested: true, searchObserved: results.length > 0 ? true : null },
    citations: { status: "unknown", bodyMappings: null }, sourceCandidates: [...candidates.values()], usage: output.usage, warnings,
  };
}
