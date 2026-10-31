import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { getQuestionSet, listQuestionVersions, saveQuestionSet } from "@/server/questions";
import { saveQuestionSetSchema } from "@/server/question-validation";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { workspaceId } = await getLocalContext();
    const [questionSet, versions] = await Promise.all([getQuestionSet(workspaceId, id), listQuestionVersions(workspaceId, id)]);
    return jsonResponse({ questionSet, versions });
  });
}

export async function PUT(request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { questions, expectedVersion } = saveQuestionSetSchema.parse(await readJsonBody(request));
    const { workspaceId } = await getLocalContext();
    return jsonResponse({ questionSet: await saveQuestionSet(workspaceId, id, expectedVersion, questions) });
  });
}
