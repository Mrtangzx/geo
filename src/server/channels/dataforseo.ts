import { z } from "zod";
import type { ExternalAnswer, ProviderQuery, ProviderRequestBody, ProviderSubmission } from "@/lib/channel-contracts";
import { array, integer, moneyText, object, safeHttpUrl, text, utcTime } from "./parsing";

export const dataForSeoSampleSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  languageCode: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/),
  locationCode: z.number().int().positive(),
  forceWebSearch: z.boolean(),
  executionId: z.uuid(),
}).strict();
export type DataForSeoSampleInput = z.infer<typeof dataForSeoSampleSchema>;
const base = "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper";
// Provider examples use UUID-shaped IDs whose version/variant bits are not
// RFC-4122 UUIDs (e.g. 07231424-0696-0066-1000-8cb255c6cd3b). These are opaque
// provider identifiers; a strict z.uuid() would reject valid documented tasks.
const providerIdSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);

export function buildDataForSeoSubmission(input: DataForSeoSampleInput): ProviderRequestBody {
  const value = dataForSeoSampleSchema.parse(input);
  return { url: `${base}/task_post`, method: "POST", body: [{
    // DataForSEO decodes %-escapes and plus signs in keyword fields. Encoding
    // the full question preserves literal +/% and never injects brand names.
    keyword: encodeURIComponent(value.question), language_code: value.languageCode,
    location_code: value.locationCode, priority: 1, force_web_search: value.forceWebSearch,
    tag: value.executionId,
  }] };
}

export function buildDataForSeoQuery(providerTaskId: string): ProviderRequestBody {
  const id = providerIdSchema.parse(providerTaskId);
  return { url: `${base}/task_get/advanced/${id}`, method: "GET", body: null };
}

export function parseDataForSeoSubmission(raw: unknown): ProviderSubmission {
  const response = object(raw); const tasks = array(response.tasks);
  if (tasks.length !== 1) return { state: "unknown", providerTaskId: null, actualCostUsd: null, reason: "供应商任务数量不匹配，需按原执行标识核对；不重复提交。" };
  const task = object(tasks[0]); const id = text(task.id);
  const cost = moneyText(task.cost);
  if (response.status_code === 20000 && task.status_code === 20100 && id && providerIdSchema.safeParse(id).success) {
    return { state: "accepted", providerTaskId: id, actualCostUsd: cost };
  }
  // Only an explicit rejected task with a zero task charge can release funds.
  // Server/transport failures, missing amounts and task-execution failures do not.
  if ([40000, 40006, 40100, 40104, 40200, 40201, 40207, 40209, 40210, 40501, 40502, 40503, 40505, 40506].includes(Number(task.status_code)) && cost === "0") {
    return { state: "not_accepted", providerTaskId: null, actualCostUsd: "0", reason: `供应商明确未受理且本任务费用为0（${task.status_code}）。` };
  }
  return { state: "unknown", providerTaskId: id, actualCostUsd: cost, reason: "提交响应尚不能证明受理或免扣费，保留预算并核对原任务。" };
}

function normalizeAnswer(result: Record<string, unknown>, task: Record<string, unknown>, requested: DataForSeoSampleInput): ExternalAnswer {
  const candidateMap = new Map<string, ExternalAnswer["sourceCandidates"][number]>();
  for (const source of array(result.search_results)) {
    const url = safeHttpUrl(object(source).url);
    if (url) candidateMap.set(url, { url, kind: "search_result" });
  }
  const sources = [...array(result.sources), ...array(result.items).flatMap((item) => array(object(item).sources))];
  for (const source of sources) {
    const url = safeHttpUrl(object(source).url);
    if (url) candidateMap.set(url, { url, kind: "provider_source_list" });
  }
  const question = text(result.keyword);
  const answerText = text(result.markdown);
  const data = object(task.data);
  const collectedAt = utcTime(result.datetime);
  const warnings = ["供应商来源列表不提供完整的正文引用片段映射，引用完整性保持未知。"];
  if (question !== requested.question) warnings.push("返回问题与已确认问题不一致或缺失，不能算有效覆盖。不得在入库时用请求问题覆盖返回问题。");
  if (!collectedAt) warnings.push("供应商来源采集时间未知，不能用本机下载时间替代。");
  if (!answerText) warnings.push("缺少供应商完整markdown，不能拼接部分items冒充全文。");
  return {
    sourceType: "consumer_web", channelId: "dataforseo_chatgpt_web", platform: "chatgpt", surface: "web",
    question, questionMatches: question === requested.question, answerText, answerComplete: !!answerText,
    requestedModel: null, returnedModel: text(result.model), collectedAt, collectedAtSource: collectedAt ? "provider" : "unknown",
    providerTaskId: text(task.id), providerRequestId: null,
    conditions: { region: integer(result.location_code) == null ? null : `dataforseo-location:${result.location_code}`,
      language: text(result.language_code), searchRequested: requested.forceWebSearch,
      // A requested flag does not prove an actual web search. Nonempty search
      // output is positive evidence; an absent/empty list is not proof of off.
      searchObserved: array(result.search_results).length > 0 ? true : null },
    citations: { status: "unknown", bodyMappings: null }, sourceCandidates: [...candidateMap.values()],
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    warnings: [...warnings, ...(text(data.tag) !== requested.executionId ? ["供应商tag与原执行标识不匹配；需人工核对原始响应。"] : [])],
  };
}

export function parseDataForSeoQuery(raw: unknown, providerTaskId: string, requested: DataForSeoSampleInput): ProviderQuery {
  const response = object(raw); const tasks = array(response.tasks);
  if (tasks.length !== 1) return { state: "unavailable", providerTaskId, reason: "原任务查询返回数量不匹配，未重提。" };
  const task = object(tasks[0]);
  if (task.id !== providerTaskId) return { state: "unavailable", providerTaskId, reason: "查询响应任务ID不匹配，未保存为当前证据。" };
  if ([40601, 40602].includes(Number(task.status_code))) return { state: "pending", providerTaskId };
  if (response.status_code !== 20000 || task.status_code !== 20000 || array(task.result).length !== 1) {
    return { state: "unavailable", providerTaskId, reason: `原任务尚无完整可用结果（${integer(task.status_code) ?? "未知状态"}）；保留原任务和费用，不自动重新采样。` };
  }
  return { state: "complete", providerTaskId, answer: normalizeAnswer(object(array(task.result)[0]), task, dataForSeoSampleSchema.parse(requested)) };
}
