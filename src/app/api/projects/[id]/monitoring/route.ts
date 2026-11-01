import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { createMonitoringPlan, createMonitoringPlanSchema, listMonitoringPlans, monitoringPrerequisites } from "@/server/monitoring";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { workspaceId } = await getLocalContext();
    const [plans, prerequisites] = await Promise.all([listMonitoringPlans(workspaceId, id), monitoringPrerequisites(workspaceId, id)]);
    return jsonResponse({ plans, prerequisites });
  });
}

export async function POST(request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const input = createMonitoringPlanSchema.parse(await readJsonBody(request));
    const { workspaceId, actorId } = await getLocalContext();
    return jsonResponse({ plan: await createMonitoringPlan(workspaceId, actorId, id, input) }, 201);
  });
}
