import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { authAccount, authUser, invitations, workspaceMemberships } from "@/db/auth-schema";
import { AppError } from "./errors";

export const acceptInvitationSchema = z.object({
  token: z.string().length(96).regex(/^[a-f0-9]+$/),
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
}).strict();

export async function acceptInvitation(input: z.infer<typeof acceptInvitationSchema>) {
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const database = getDatabase();
  const [candidate] = await database.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1);
  if (!candidate || candidate.usedAt || candidate.expiresAt <= new Date() || candidate.email !== input.email) {
    throw new AppError(400, "INVITATION_INVALID", "邀请无效、已使用、已过期或邮箱不匹配，请联系操作员。");
  }
  // Use Better Auth's own password hash format. Sessions/cookies are created only
  // by Better Auth sign-in, never by the invitation provisioning endpoint.
  const password = await hashPassword(input.password);
  const now = new Date();
  const userId = randomUUID();
  try {
    await database.transaction(async (tx) => {
      const [invitation] = await tx.select().from(invitations).where(and(eq(invitations.id, candidate.id), isNull(invitations.usedAt))).for("update");
      if (!invitation || invitation.expiresAt <= new Date() || invitation.email !== input.email) {
        throw new AppError(400, "INVITATION_INVALID", "邀请无效、已使用或已过期，请联系操作员。");
      }
      const [existing] = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, input.email)).limit(1);
      if (existing) throw new AppError(409, "ACCOUNT_EXISTS", "该邮箱已有账号，请直接登录或联系操作员处理工作区归属。");
      await tx.insert(authUser).values({ id: userId, name: input.name, email: input.email, emailVerified: false, createdAt: now, updatedAt: now });
      await tx.insert(authAccount).values({ id: randomUUID(), accountId: userId, providerId: "credential", userId, password, createdAt: now, updatedAt: now });
      await tx.insert(workspaceMemberships).values({ userId, workspaceId: invitation.workspaceId, createdAt: now });
      await tx.update(invitations).set({ usedAt: now, acceptedUserId: userId }).where(eq(invitations.id, invitation.id));
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new AppError(409, "ACCOUNT_EXISTS", "该邮箱已有账号，请直接登录或联系操作员。");
    }
    throw error;
  }
  return { accepted: true, needsLogin: true };
}
