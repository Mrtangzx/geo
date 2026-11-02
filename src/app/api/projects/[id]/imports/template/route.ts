import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { projectIdSchema } from "@/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { getProject } from "@/server/projects";
import { getConfirmedSamplingQuestions } from "@/server/questions";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const version = z.coerce.number().int().positive().parse(new URL(request.url).searchParams.get("questionVersion"));
  const project = await getProject(workspaceId, id); const { inputs } = await getConfirmedSamplingQuestions(workspaceId, id, version);
  const example = { sourceId: "replace-with-source-record-id", questionId: inputs[0].questionId, questionText: inputs[0].text, platform: "doubao", surface: "web", sourceType: "manual_import", isSynthetic: project.isSynthetic,
    collectedAt: null, collectedBy: "请填写实际采集人", status: "success", answerText: "请替换成完整原始回答；不把资料说明或标签当作回答。",
    capture: { questionVerified: false, platformVerified: false, answerComplete: false, timeVerified: false },
    citations: { status: "unknown", bodyMappings: null }, sourceCandidates: [], conditions: { region: null, language: null, searchMode: null, model: null }, sourceUrl: null, notes: "条件不清楚时保持null；不得补写采集时间。", siteVersion: null };
  return new Response(JSON.stringify(example) + "\n", { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": "attachment; filename=manual-evidence-template.jsonl", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}); }
