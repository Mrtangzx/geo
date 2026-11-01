import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";
import { getReport } from "@/server/reports";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; reportId: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const params = await context.params;
    const id = projectIdSchema.parse(params.id), reportId = projectIdSchema.parse(params.reportId);
    const { workspaceId } = await getLocalContext();
    return jsonResponse({ report: await getReport(workspaceId, id, reportId) });
  });
}
