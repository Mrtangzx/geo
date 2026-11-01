import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
import { listEvidence } from "@/server/sampling";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  return jsonResponse({ evidence: await listEvidence(workspaceId, id) });
}); }
