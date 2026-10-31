import { AppError } from "./errors";

export type AuthMode = "local" | "invite";

export function getAuthMode(): AuthMode {
  const value = process.env.GEO_AUTH_MODE ?? "local";
  if (value !== "local" && value !== "invite") {
    throw new AppError(503, "AUTH_NOT_CONFIGURED", "登录模式配置无效，请联系操作员检查 GEO_AUTH_MODE。");
  }
  return value;
}

export function getInviteAuthConfig() {
  if (getAuthMode() !== "invite") {
    throw new AppError(503, "AUTH_NOT_ENABLED", "当前是仅限本机的研发预览，邀请登录尚未启用。");
  }
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError(503, "AUTH_NOT_CONFIGURED", "邀请登录待配置，请操作员设置有效的登录密钥。");
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(process.env.BETTER_AUTH_URL ?? "");
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname);
    if (!loopback && baseUrl.protocol !== "https:") throw new Error("https required");
    if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
      throw new Error("invalid origin");
    }
  } catch {
    throw new AppError(503, "AUTH_NOT_CONFIGURED", "邀请登录地址待配置，外部访问必须使用 HTTPS。");
  }
  return { secret, baseURL: baseUrl.origin, secureCookies: baseUrl.protocol === "https:" };
}

export function requireAuthOrigin(request: Request) {
  const { baseURL } = getInviteAuthConfig();
  const origin = request.headers.get("origin");
  if ((origin && origin !== baseURL) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError(403, "ORIGIN_REJECTED", "请求来源不匹配，请从当前应用页面操作。");
  }
}
