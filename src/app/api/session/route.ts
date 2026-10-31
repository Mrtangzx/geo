import { getSessionStatus } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleApi(async () => jsonResponse(await getSessionStatus()));
}
