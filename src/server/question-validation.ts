import { z } from "zod";
import { questionGroups, questionPriorities, questionSources } from "@/lib/question-contracts";

const questionInputSchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string().trim().max(2000),
  group: z.enum(questionGroups),
  sourceType: z.enum(questionSources),
  sourceRef: z.string().trim().max(2000),
  sourceModel: z.string().trim().max(200).nullable().default(null),
  priority: z.enum(questionPriorities),
  isFocus: z.boolean(),
}).strict().superRefine((question, context) => {
  if (question.sourceType !== "model_suggestion" && question.sourceModel) {
    context.addIssue({ code: "custom", path: ["sourceModel"], message: "只有模型补充问题可记录来源模型。" });
  }
});

export const saveQuestionSetSchema = z.object({
  questions: z.array(questionInputSchema).max(20, "每个项目最多 20 个问题。"),
  expectedVersion: z.number().int().nonnegative(),
}).strict().superRefine(({ questions }, context) => {
  const ids = questions.flatMap((question) => question.id ? [question.id] : []);
  if (ids.length !== new Set(ids).size) context.addIssue({ code: "custom", path: ["questions"], message: "问题标识不能重复。" });
});

export const confirmQuestionSetSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

export const confirmableQuestionsSchema = z.array(questionInputSchema).min(1, "请至少填写一个问题后确认。").max(20)
  .superRefine((questions, context) => {
    const seen = new Map<string, number>();
    questions.forEach((question, index) => {
      if (!question.text) context.addIssue({ code: "custom", path: [index, "text"], message: `第 ${index + 1} 题缺少问题文本。` });
      if (!question.sourceRef) context.addIssue({ code: "custom", path: [index, "sourceRef"], message: `第 ${index + 1} 题缺少来源说明。` });
      const normalized = question.text.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
      if (normalized && seen.has(normalized)) {
        context.addIssue({ code: "custom", path: [index, "text"], message: `第 ${index + 1} 题与第 ${seen.get(normalized)! + 1} 题重复。` });
      } else if (normalized) seen.set(normalized, index);
    });
  });
