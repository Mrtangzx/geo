import { z } from "zod";
import { getLocalContext } from "@/server/context";
import { getAuthMode } from "@/server/auth-config";
import { AppError, handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { getProject } from "@/server/projects";
import { generateProjectTasks, listTasks } from "@/server/task-repository";
import { listFixtureTaskSnapshots } from "@/server/task-offline-pages";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const { workspaceId, actorId } = await getLocalContext();
    const id = projectIdSchema.parse((await context.params).id);
    const project = await getProject(workspaceId, id);
    return jsonResponse({ tasks: await listTasks(workspaceId, id), canManuallyVerify: getAuthMode() === "local" && actorId === "local-operator", mode: project.isSynthetic ? "synthetic_preview" : "live", fixtureSnapshots: project.isSynthetic ? await listFixtureTaskSnapshots() : [] });
  });
}
export async function POST(request: Request, context: Context) {
  return handleApi(async () => {
    const { workspaceId, actorId } = await getLocalContext();
    const id = projectIdSchema.parse((await context.params).id);
    const input = z.object({ mode: z.enum(["synthetic_template", "analysis_diagnosis"]) }).strict().parse(await readJsonBody(request));
    const project = await getProject(workspaceId, id);
    if (project.isSynthetic !== (input.mode === "synthetic_template")) throw new AppError(409, "TASK_SOURCE_MISMATCH", "请显式选择与当前项目匹配的合成演练或真实诊断来源。");
    return jsonResponse({ tasks: await generateProjectTasks(workspaceId, id, actorId) }, 201);
  });
}
