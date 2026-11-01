import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
import { z } from "zod";
import { createEvidenceAnalysis, listLatestAnalyses, replaySyntheticAnalyses } from "@/server/analysis-repository";
import { createMetricsSnapshot, listMetricsSnapshots } from "@/server/analysis-metrics";
import { getAnalysisModelStatus } from "@/server/analysis-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const [analyses, metrics] = await Promise.all([listLatestAnalyses(workspaceId, id), listMetricsSnapshots(workspaceId, id)]);
  return jsonResponse({ analyses, metrics, model: getAnalysisModelStatus() });
}); }
export async function POST(request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId, actorId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("replay"), confirmSyntheticReference: z.literal(true) }).strict(),
    z.object({ action: z.literal("metrics") }).strict(),
    z.object({ action: z.literal("analyse"), evidenceId: z.uuid(), mode: z.enum(["model", "manual_review", "synthetic_reference"]), expectedRevision: z.number().int().min(0), reason: z.string().max(2000).optional(), confirmSyntheticReference: z.boolean().optional(), labels: z.unknown().optional() }).strict(),
  ]).parse(await readJsonBody(request));
  if (input.action === "replay") return jsonResponse(await replaySyntheticAnalyses(workspaceId, id, actorId));
  if (input.action === "metrics") return jsonResponse({ metrics: await createMetricsSnapshot(workspaceId, actorId, id) }, 201);
  return jsonResponse({ analysis: await createEvidenceAnalysis(workspaceId, id, actorId, input.evidenceId, input) }, 201);
}); }
