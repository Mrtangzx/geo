import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
import { createRun, createRunSchema, listRuns } from "@/server/sampling";
import { getQuestionSet } from "@/server/questions";
import { listReservations } from "@/server/budgets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const [runs, questions, reservations] = await Promise.all([listRuns(workspaceId, id), getQuestionSet(workspaceId, id), listReservations(workspaceId, id)]);
  return jsonResponse({ runs, questionVersion: questions.latestConfirmedVersion, reservations, readiness: { realDomestic: "pending_configuration", realPaidCalls: false } });
}); }
export async function POST(request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId, actorId } = await getLocalContext(); const id = projectIdSchema.parse((await context.params).id);
  const input = createRunSchema.parse(await readJsonBody(request));
  return jsonResponse({ run: await createRun(workspaceId, actorId, id, input) }, 202);
}); }
