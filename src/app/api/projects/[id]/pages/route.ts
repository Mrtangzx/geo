import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { getPageCollection, savePageCollection } from "@/server/page-repository";
import { pageCollectionSchema } from "@/server/page-validation";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { workspaceId } = await getLocalContext();
    return jsonResponse(await getPageCollection(workspaceId, id));
  });
}

export async function PUT(request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { workspaceId } = await getLocalContext();
    const input = pageCollectionSchema.parse(await readJsonBody(request));
    const collection = await savePageCollection(workspaceId, id, input);
    return jsonResponse({ collection });
  });
}
