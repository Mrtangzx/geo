import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { checkSelectedPage } from "@/server/page-repository";
import { pageCheckSchema, selectedPageIdSchema } from "@/server/page-validation";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;
type Context = { params: Promise<{ id: string; pageId: string }> };

export async function POST(request: Request, context: Context) {
  return handleApi(async () => {
    const params = await context.params;
    const id = projectIdSchema.parse(params.id);
    const pageId = selectedPageIdSchema.parse(params.pageId);
    const { workspaceId, actorId } = await getLocalContext();
    pageCheckSchema.parse(await readJsonBody(request));
    return jsonResponse({ snapshot: await checkSelectedPage(workspaceId, actorId, id, pageId, request.signal) });
  });
}
