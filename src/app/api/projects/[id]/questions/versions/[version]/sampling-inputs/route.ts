import { z } from "zod";
import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";
import { getConfirmedSamplingQuestions } from "@/server/questions";
import { projectIdSchema } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; version: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const params = await context.params;
    const id = projectIdSchema.parse(params.id);
    const version = z.coerce.number().int().positive().parse(params.version);
    const { workspaceId } = await getLocalContext();
    const result = await getConfirmedSamplingQuestions(workspaceId, id, version);
    return jsonResponse({ questionVersion: version, inputs: result.inputs });
  });
}
