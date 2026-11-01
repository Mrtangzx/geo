import { z } from "zod";
import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { editTask, getTask, listTaskEvents } from "@/server/task-repository";
import { taskDraftSchema } from "@/server/task-validation";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; taskId: string }> };
export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const { workspaceId } = await getLocalContext(); const params = await context.params;
    const id = projectIdSchema.parse(params.id); const taskId = z.string().uuid().parse(params.taskId);
    return jsonResponse({ task: await getTask(workspaceId, id, taskId), events: await listTaskEvents(workspaceId, id, taskId) });
  });
}
export async function PUT(request: Request, context: Context) {
  return handleApi(async () => {
    const { workspaceId, actorId } = await getLocalContext(); const params = await context.params;
    const id = projectIdSchema.parse(params.id); const taskId = z.string().uuid().parse(params.taskId);
    return jsonResponse({ task: await editTask(workspaceId, id, taskId, actorId, taskDraftSchema.parse(await readJsonBody(request))) });
  });
}
