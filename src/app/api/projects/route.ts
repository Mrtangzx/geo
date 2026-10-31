import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { createProject, listProjects } from "@/server/projects";
import { projectInputSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleApi(async () => {
    const { workspaceId } = await getLocalContext();
    return jsonResponse({ projects: await listProjects(workspaceId) });
  });
}

export async function POST(request: Request) {
  return handleApi(async () => {
    const { workspaceId, actorId } = await getLocalContext();
    const input = projectInputSchema.parse(await readJsonBody(request));
    return jsonResponse({ project: await createProject(workspaceId, actorId, input) }, 201);
  });
}
