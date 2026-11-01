import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { changeMonitoringState, getMonitoringPlan, listMonitoringOccurrences, monitoringStateSchema } from "@/server/monitoring";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; planId: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const params = await context.params;
    const id = projectIdSchema.parse(params.id);
    const planId = projectIdSchema.parse(params.planId);
    const { workspaceId } = await getLocalContext();
    const [plan, occurrences] = await Promise.all([getMonitoringPlan(workspaceId, id, planId), listMonitoringOccurrences(workspaceId, id, planId)]);
    return jsonResponse({ plan, occurrences });
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleApi(async () => {
    const params = await context.params;
    const id = projectIdSchema.parse(params.id);
    const planId = projectIdSchema.parse(params.planId);
    const input = monitoringStateSchema.parse(await readJsonBody(request));
    const { workspaceId, actorId } = await getLocalContext();
    return jsonResponse({ plan: await changeMonitoringState(workspaceId, actorId, id, planId, input.expectedRevision, input.state) });
  });
}
