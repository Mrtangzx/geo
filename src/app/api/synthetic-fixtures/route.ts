import { z } from "zod";
import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { seedFixtureProject } from "@/server/synthetic-fixtures";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const { workspaceId, actorId } = await getLocalContext();
    z.object({ confirmSynthetic: z.literal(true) }).strict().parse(await readJsonBody(request));
    return jsonResponse({ seed: await seedFixtureProject(workspaceId, actorId) }, 201);
  });
}
