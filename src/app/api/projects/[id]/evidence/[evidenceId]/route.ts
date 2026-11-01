import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
import { z } from "zod";
import { getAnalysisEvidenceBundle } from "@/server/analysis-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; evidenceId: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const p = await context.params;
  return jsonResponse(await getAnalysisEvidenceBundle(workspaceId, projectIdSchema.parse(p.id), z.uuid().parse(p.evidenceId)));
}); }
