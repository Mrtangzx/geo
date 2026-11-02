import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { projectIdSchema } from "@/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { getEvidenceAttachment } from "@/server/evidence-attachments";
type Context = { params: Promise<{ id: string; evidenceId: string; attachmentId: string }> };
export async function GET(_request: Request, context: Context) { return handleApi(async () => {
  const { workspaceId } = await getLocalContext(); const p = await context.params;
  const { metadata, body } = await getEvidenceAttachment(workspaceId, projectIdSchema.parse(p.id), z.uuid().parse(p.evidenceId), z.uuid().parse(p.attachmentId));
  return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/png", "Content-Length": String(body.length), "Content-Disposition": `inline; filename="screenshot-${metadata.id}.png"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'" } });
}); }
