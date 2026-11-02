import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { getManualImport } from "@/server/manual-imports";
type Context = { params: Promise<{ id: string; batchId: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const p = await context.params;
  return jsonResponse(await getManualImport(workspaceId, projectIdSchema.parse(p.id), z.uuid().parse(p.batchId)));
}); }
