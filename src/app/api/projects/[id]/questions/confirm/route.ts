import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { confirmQuestionSet } from "@/server/questions";
import { confirmQuestionSetSchema } from "@/server/question-validation";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { expectedVersion } = confirmQuestionSetSchema.parse(await readJsonBody(request));
    const { workspaceId, actorId } = await getLocalContext();
    return jsonResponse(await confirmQuestionSet(workspaceId, id, actorId, expectedVersion));
  });
}
