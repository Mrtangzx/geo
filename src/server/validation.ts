import { z } from "zod";

const publicUrl = z.string().trim().max(2048).url("请填写完整网址。").refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "网址仅支持不含凭证的 HTTP(S) 地址。");

const optionalUrl = z.union([z.literal(""), publicUrl]);
const factInput = z.object({
  id: z.string().uuid().optional(),
  statement: z.string().trim().min(1, "请填写事实内容。").max(8000),
  sourceUrl: optionalUrl,
  sourceRef: z.string().trim().max(4000).optional(),
  status: z.enum(["confirmed", "needs_confirmation"]),
}).strict().superRefine((fact, context) => {
  if (fact.status === "confirmed" && !fact.sourceUrl && !fact.sourceRef?.trim()) {
    context.addIssue({ code: "custom", path: ["sourceRef"], message: "确认事实前请补充来源网址或可核对的资料引用。" });
  }
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "请填写品牌名称。").max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(30),
  websiteUrl: publicUrl,
  product: z.string().trim().max(8000),
  targetCustomers: z.string().trim().max(8000),
  competitors: z.array(z.object({
    name: z.string().trim().min(1, "请填写竞品名称。").max(200),
    websiteUrl: optionalUrl,
  }).strict()).max(3, "最多添加 3 个竞品。"),
  facts: z.array(factInput).max(200),
  isSynthetic: z.boolean(),
}).strict().superRefine((input, context) => {
  const ids = input.facts.flatMap((fact) => fact.id ? [fact.id] : []);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["facts"], message: "事实标识不能重复。" });
});

export const updateProjectSchema = projectInputSchema.safeExtend({
  expectedVersion: z.number().int().positive(),
});

export const projectIdSchema = z.string().uuid("无效的项目标识。");
