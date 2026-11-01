import { z } from "zod";
import { getLocalContext } from "@/server/context";
import { getAuthMode } from "@/server/auth-config";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { performTaskAction } from "@/server/task-repository";
import { taskActionSchema } from "@/server/task-validation";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; taskId: string }> };
export async function POST(request: Request, context: Context) {
  return handleApi(async () => {
    const { workspaceId, actorId } = await getLocalContext(); const params = await context.params;
    const id = projectIdSchema.parse(params.id); const taskId = z.string().uuid().parse(params.taskId);
    const input = taskActionSchema.parse(await readJsonBody(request));
    return jsonResponse({ task: await performTaskAction(workspaceId, id, taskId, actorId, input, getAuthMode() === "local" && actorId === "local-operator") });
  });
}
