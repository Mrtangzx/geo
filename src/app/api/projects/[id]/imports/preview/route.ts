import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { previewManualImport } from "@/server/manual-imports";
import { manualImportInputSchema } from "@/server/import-validation";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const input = manualImportInputSchema.parse(await readJsonBody(request, 3 * 1024 * 1024));
  return jsonResponse({ preview: await previewManualImport(workspaceId, id, input) });
}); }
