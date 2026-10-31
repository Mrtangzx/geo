import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";
import { listPageSnapshots } from "@/server/page-repository";
import { selectedPageIdSchema } from "@/server/page-validation";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; pageId: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const params = await context.params;
    const id = projectIdSchema.parse(params.id);
    const pageId = selectedPageIdSchema.parse(params.pageId);
    const { workspaceId } = await getLocalContext();
    return jsonResponse({ snapshots: await listPageSnapshots(workspaceId, id, pageId) });
  });
}
