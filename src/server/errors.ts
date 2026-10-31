import { ZodError } from "zod";
import type { ApiError } from "@/lib/contracts";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function handleApi(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    let status = 500;
    let body: ApiError = { error: "操作暂未完成，请重试。", code: "INTERNAL_ERROR" };
    if (error instanceof AppError) {
      status = error.status;
      body = { error: error.message, code: error.code };
    } else if (error instanceof ZodError) {
      status = 400;
      body = {
        error: "请检查填写内容。",
        code: "VALIDATION_ERROR",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      };
    } else if (isDatabaseError(error)) {
      status = 503;
      body = {
        code: "DATABASE_UNAVAILABLE",
        error: "数据库尚未就绪。请检查 DATABASE_URL、PostgreSQL 服务和数据库迁移后重试。",
      };
    }
    // Raw driver errors can contain connection details: do not return or log them.
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}

function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; cause?: unknown; message?: string };
  if (candidate.code && /^(?:[0-9A-Z]{5}|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)$/.test(candidate.code)) return true;
  if (candidate.message?.includes("Connection terminated") || candidate.message?.includes("connection timeout")) return true;
  return candidate.cause ? isDatabaseError(candidate.cause) : false;
}
