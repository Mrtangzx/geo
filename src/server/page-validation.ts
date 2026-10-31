import { z } from "zod";
import { AppError } from "./errors";

export function normalizePageUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new AppError(400, "INVALID_PAGE_URL", "请填写完整的 HTTP(S) 页面网址。"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new AppError(400, "INVALID_PAGE_URL", "仅支持不含凭证的 HTTP(S) 公共网页。");
  }
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) {
    throw new AppError(400, "UNSUPPORTED_PAGE_PORT", "公开页面检查仅支持标准 HTTP(S) 端口。");
  }
  if (url.href.length > 2048) throw new AppError(400, "PAGE_URL_TOO_LONG", "页面网址不能超过 2048 个字符。");
  url.hash = "";
  return url;
}

const pageUrl = z.string().trim().min(1, "请填写页面网址。").max(2048).transform((value, context) => {
  try { return normalizePageUrl(value).href; } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "页面网址无效。" });
    return z.NEVER;
  }
});

export const pageCollectionSchema = z.object({
  expectedVersion: z.number().int().min(0),
  pages: z.array(z.object({
    id: z.string().uuid().optional(),
    url: pageUrl,
    label: z.string().trim().max(200),
  }).strict()).max(10, "每个项目最多选择 10 个页面。"),
}).strict().superRefine((input, context) => {
  if (new Set(input.pages.map((page) => page.url)).size !== input.pages.length) context.addIssue({ code: "custom", path: ["pages"], message: "不能重复选择同一页面。" });
  const ids = input.pages.flatMap((page) => page.id ? [page.id] : []);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["pages"], message: "页面标识不能重复。" });
});

export const selectedPageIdSchema = z.string().uuid("页面标识无效。");
export const pageSnapshotIdSchema = z.string().uuid("快照标识无效。");
export const pageCheckSchema = z.object({}).strict();
