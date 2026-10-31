import { getAuth } from "@/server/auth";
import { requireAuthOrigin } from "@/server/auth-config";
import { handleApi } from "@/server/errors";
import { jsonResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authHandler(request: Request) {
  return handleApi(async () => {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
    if (!["/sign-in/email", "/sign-out", "/get-session"].includes(path)) {
      return jsonResponse({ error: "此登录入口未开放。新账号需使用有效邀请。", code: "AUTH_ENDPOINT_DISABLED" }, 403);
    }
    requireAuthOrigin(request);
    return getAuth().handler(request);
  });
}

export const GET = authHandler;
export const POST = authHandler;
