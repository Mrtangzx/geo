import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors";

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 100;
const nullableText = z.string().trim().min(1).max(120).nullable();
const httpUrl = z.string().trim().max(2000).refine((value) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "链接必须是无账号密码的 HTTP(S) 地址；本次仅保存，不会抓取。");

export const manualImportInputSchema = z.object({
  projectVersion: z.number().int().positive(), questionVersion: z.number().int().positive(),
  period: z.enum(["baseline", "review-1", "review-2", "edge"]), format: z.enum(["json", "jsonl"]),
  filename: z.string().trim().min(1).max(160), content: z.string().min(1).max(MAX_IMPORT_BYTES),
}).strict();
export const manualImportCommitSchema = manualImportInputSchema.extend({
  requestId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmManualSource: z.literal(true),
}).strict();

export const manualRowSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  questionId: z.uuid().optional(), questionText: z.string().trim().min(1).max(2000),
  platform: z.string().trim().min(1).max(100), surface: z.enum(["web", "app", "unknown"]),
  sourceType: z.literal("manual_import").optional(),
  isSynthetic: z.boolean(), collectedAt: z.iso.datetime({ offset: true }).nullable(),
  collectedBy: z.string().trim().min(1).max(160), answerText: z.string().max(100000).nullable(),
  status: z.enum(["success", "failed", "unknown"]),
  capture: z.object({ questionVerified: z.boolean(), platformVerified: z.boolean(), answerComplete: z.boolean(), timeVerified: z.boolean() }).strict(),
  citations: z.object({ status: z.enum(["complete", "unknown", "unsupported"]), bodyMappings: z.array(z.object({ quote: z.string().min(1).max(12000), url: httpUrl }).strict()).max(50).nullable() }).strict(),
  sourceCandidates: z.array(z.object({ url: httpUrl, kind: z.enum(["source_list", "search_candidate"]) }).strict()).max(50).default([]),
  conditions: z.object({ region: nullableText, language: nullableText, searchMode: nullableText, model: nullableText }).strict(),
  sourceUrl: httpUrl.nullable().default(null), notes: z.string().max(4000).default(""),
  siteVersion: z.string().trim().min(1).max(120).nullable().default(null),
}).strict().superRefine((row, ctx) => {
  if (row.collectedAt && Date.parse(row.collectedAt) > Date.now() + 300000) ctx.addIssue({ code: "custom", path: ["collectedAt"], message: "人工采集时间不能是尚未发生的未来时间。" });
  if (row.capture.timeVerified && !row.collectedAt) ctx.addIssue({ code: "custom", path: ["collectedAt"], message: "声明时间已核对时必须提供带时区的采集时间。" });
  if (row.citations.status === "complete" && !Array.isArray(row.citations.bodyMappings)) ctx.addIssue({ code: "custom", path: ["citations"], message: "完整引用需提供正文映射数组；确实无引用使用空数组。" });
  if (row.citations.status !== "complete" && row.citations.bodyMappings !== null) ctx.addIssue({ code: "custom", path: ["citations"], message: "正文映射未知或不支持时应为null，来源列表单独保存。" });
  for (const citation of row.citations.bodyMappings ?? []) if (!row.answerText?.includes(citation.quote)) ctx.addIssue({ code: "custom", path: ["citations"], message: "正文引用片段未出现在回答原文，不能据此计官网引用。" });
});

export type ManualRow = z.infer<typeof manualRowSchema>;
export function importFingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function manualContentHash(row: ManualRow, projectVersion: number, questionVersion: number, questionId: string) {
  const { sourceId: _sourceId, notes: _notes, collectedBy: _collectedBy, ...data } = row;
  // Different upload IDs/notes do not turn identical source evidence into a new sample.
  void _sourceId; void _notes; void _collectedBy;
  return importFingerprint({ data: { ...data, sourceType: "manual_import", questionId, collectedAt: row.collectedAt ? new Date(row.collectedAt).toISOString() : null }, projectVersion, questionVersion });
}
export function manualSourceKey(row: ManualRow) { return importFingerprint([row.platform, row.surface, row.sourceId]); }

export function parseImportRows(content: string, format: "json" | "jsonl"): { line: number; value?: unknown; error?: string }[] {
  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) throw new AppError(413, "IMPORT_TOO_LARGE", "回答资料文件最多1MB，请分批导入。");
  const source = content.replace(/^\uFEFF/, "");
  let rows: { line: number; value?: unknown; error?: string }[];
  if (format === "json") {
    try { const value: unknown = JSON.parse(source); rows = (Array.isArray(value) ? value : [value]).map((v, i) => ({ line: i + 1, value: v })); }
    catch { return [{ line: 1, error: "不是有效JSON；整批未写入。" }]; }
  } else rows = source.split(/\r?\n/).flatMap<{ line: number; value?: unknown; error?: string }>((line, i) => {
    if (!line.trim()) return [];
    try { return [{ line: i + 1, value: JSON.parse(line) as unknown }]; }
    catch { return [{ line: i + 1, error: "该行不是有效JSON；整批未写入。" }]; }
  });
  if (!rows.length || rows.length > MAX_IMPORT_ROWS) throw new AppError(400, "IMPORT_ROW_LIMIT", "每批需1至100条回答，请分批处理。");
  return rows;
}

export function manualRowWarnings(row: ManualRow): string[] {
  const result: string[] = [];
  if (row.status !== "success") result.push("采集失败或结果未知；保留资料但不当作有效回答。");
  if (!row.answerText?.trim()) result.push("缺少回答全文。");
  if (!row.collectedAt || !row.capture.timeVerified) result.push("采集时间缺失或未核对。");
  if (!row.capture.questionVerified) result.push("实际问题尚未核对。");
  if (!row.capture.platformVerified || row.surface === "unknown") result.push("平台或Web/App渠道尚未核对。");
  if (!row.capture.answerComplete) result.push("回答完整性尚未确认。");
  if (row.citations.status !== "complete") result.push("正文引用未知，不记为无引用。");
  if (Object.values(row.conditions).some((v) => v === null)) result.push("部分采集条件未知，仅供观察。");
  return result;
}
