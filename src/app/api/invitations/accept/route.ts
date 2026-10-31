import { acceptInvitation, acceptInvitationSchema } from "@/server/auth-invitations";
import { requireAuthOrigin } from "@/server/auth-config";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleApi(async () => {
    requireAuthOrigin(request);
    const input = acceptInvitationSchema.parse(await readJsonBody(request));
    return jsonResponse(await acceptInvitation(input), 201);
  });
}
