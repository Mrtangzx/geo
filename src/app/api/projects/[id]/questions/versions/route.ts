import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";
import { listQuestionVersions } from "@/server/questions";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { workspaceId } = await getLocalContext();
    return jsonResponse({ versions: await listQuestionVersions(workspaceId, id) });
  });
}
