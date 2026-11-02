import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { getProject } from "@/server/projects";
import { listQuestionVersions } from "@/server/questions";
import { commitManualImport, listManualImports } from "@/server/manual-imports";
import { manualImportCommitSchema } from "@/server/import-validation";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const [project, versions, batches] = await Promise.all([getProject(workspaceId, id), listQuestionVersions(workspaceId, id), listManualImports(workspaceId, id)]);
  return jsonResponse({ projectVersion: project.version, isSynthetic: project.isSynthetic, versions, batches });
}); }
export async function POST(request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId, actorId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const { requestId, fingerprint, confirmManualSource, ...input } = manualImportCommitSchema.parse(await readJsonBody(request, 3 * 1024 * 1024));
  if (!confirmManualSource) throw new Error("unconfirmed import");
  return jsonResponse({ batch: await commitManualImport(workspaceId, actorId, id, input, { requestId, fingerprint }) }, 201);
}); }
