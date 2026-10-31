import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDatabase } from "@/db/client";
import { betterAuthSchema } from "@/db/auth-schema";
import { getInviteAuthConfig } from "./auth-config";

function createAuth() {
  const config = getInviteAuthConfig();
  return betterAuth({
    appName: "GEO 品牌工作台",
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: [config.baseURL],
    database: drizzleAdapter(getDatabase(), { provider: "pg", schema: betterAuthSchema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: config.secureCookies, defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
    rateLimit: { enabled: true, window: 60, max: 30 },
    logger: { disabled: true },
  });
}

type GeoAuth = ReturnType<typeof createAuth>;
let cached: { key: string; auth: GeoAuth } | undefined;

export function getAuth(): GeoAuth {
  const config = getInviteAuthConfig();
  const key = `${config.baseURL}:${config.secret}`;
  if (!cached || cached.key !== key) cached = { key, auth: createAuth() };
  return cached.auth;
}
