import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { addEvidenceAttachment, attachmentInputSchema, listEvidenceAttachments } from "@/server/evidence-attachments";
type Context = { params: Promise<{ id: string; evidenceId: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const p = await context.params;
  return jsonResponse({ attachments: await listEvidenceAttachments(workspaceId, projectIdSchema.parse(p.id), z.uuid().parse(p.evidenceId)) });
}); }
export async function POST(request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId, actorId } = await getLocalContext(); const p = await context.params;
  const input = attachmentInputSchema.parse(await readJsonBody(request, 7 * 1024 * 1024));
  return jsonResponse({ attachment: await addEvidenceAttachment(workspaceId, actorId, projectIdSchema.parse(p.id), z.uuid().parse(p.evidenceId), input) }, 201);
}); }
