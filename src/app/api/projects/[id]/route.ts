import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { getProject, updateProject } from "@/server/projects";
import { projectIdSchema, updateProjectSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const { workspaceId } = await getLocalContext();
    return jsonResponse({ project: await getProject(workspaceId, id) });
  });
}

export async function PUT(request: Request, context: Context) {
  return handleApi(async () => {
    const id = projectIdSchema.parse((await context.params).id);
    const parsed = updateProjectSchema.parse(await readJsonBody(request));
    const { expectedVersion, ...input } = parsed;
    const { workspaceId, actorId } = await getLocalContext();
    return jsonResponse({ project: await updateProject(workspaceId, actorId, id, expectedVersion, input) });
  });
}
