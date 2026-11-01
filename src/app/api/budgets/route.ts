import { z } from "zod";
import { getLocalContext } from "@/server/context";
import { getAuthMode } from "@/server/auth-config";
import { AppError, handleApi } from "@/server/errors";
import { jsonResponse, readJsonBody } from "@/server/http";
import { configureBudget, listBudgets } from "@/server/budgets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return handleApi(async () => {
  const { workspaceId } = await getLocalContext();
  return jsonResponse({ accounts: await listBudgets(workspaceId), canConfigure: getAuthMode() === "local" });
}); }
export async function PATCH(request: Request) { return handleApi(async () => {
  const { workspaceId, actorId } = await getLocalContext();
  if (getAuthMode() !== "local" || actorId !== "local-operator") throw new AppError(403, "OPERATOR_REQUIRED", "额度由本机操作员配置，受邀账号不能更改预算上限。");
  const input = z.object({ kind: z.literal("simulation"), currency: z.enum(["CNY", "USD"]), limitMinor: z.number().int().min(0).max(1000000000), expectedVersion: z.number().int().min(0) }).strict().parse(await readJsonBody(request));
  return jsonResponse({ accounts: await configureBudget(workspaceId, input.kind, input.currency, input.limitMinor, input.expectedVersion) });
}); }
