import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { getAuthMode } from "@/server/auth-config";
import { getRun, changeRunState, reconcileRun } from "@/server/sampling";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; runId: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const p = await context.params;
  return jsonResponse({ run: await getRun(workspaceId, projectIdSchema.parse(p.id), z.uuid().parse(p.runId)) });
}); }
export async function PATCH(request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId, actorId } = await getLocalContext(); const p = await context.params;
  const id = projectIdSchema.parse(p.id); const runId = z.uuid().parse(p.runId);
  const input = z.discriminatedUnion("action", [z.object({ action: z.enum(["pause", "resume", "cancel"]) }).strict(), z.object({ action: z.literal("reconcile"), accepted: z.boolean(), actualMinor: z.number().int().min(0).max(50), reason: z.string().trim().min(8).max(1000) }).strict()]).parse(await readJsonBody(request));
  if (input.action === "reconcile") {
    if (getAuthMode() !== "local" || actorId !== "local-operator") throw new AppError(403, "OPERATOR_REQUIRED", "模拟费用核对仅限本机操作员。");
    return jsonResponse({ run: await reconcileRun(workspaceId, actorId, id, runId, input) });
  }
  return jsonResponse({ run: await changeRunState(workspaceId, id, runId, input.action) });
}); }
