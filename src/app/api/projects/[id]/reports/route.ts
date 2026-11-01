import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { createReport, createReportSchema, listReports } from "@/server/reports";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { workspaceId } = await getLocalContext();
    return jsonResponse({ reports: await listReports(workspaceId, id) });
  });
}

export async function POST(request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { metricsSnapshotId } = createReportSchema.parse(await readJsonBody(request));
    const { workspaceId, actorId } = await getLocalContext();
    return jsonResponse({ report: await createReport(workspaceId, actorId, id, metricsSnapshotId) }, 201);
  });
}
