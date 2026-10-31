import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { workspaceMemberships } from "@/db/auth-schema";
import { workspaces } from "@/db/schema";
import { getAuth } from "./auth";
import { getAuthMode } from "./auth-config";
import { AppError } from "./errors";

export interface SessionStatus {
  mode: "local" | "invite";
  user: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string } | null;
  needsLogin: boolean;
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const mode = getAuthMode();
  const requestHeaders = await headers();
  if (mode === "local") {
    const host = requestHeaders.get("host");
    try {
      if (!host || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${host}`).hostname)) throw new Error("not loopback");
    } catch {
      throw new AppError(403, "LOCAL_ONLY", "本地研发预览仅允许通过本机地址访问。");
    }
    return { mode, user: null, workspace: { id: "local-workspace", name: "本地研发工作区" }, needsLogin: false };
  }
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return { mode, user: null, workspace: null, needsLogin: true };
  const [membership] = await getDatabase().select({ id: workspaces.id, name: workspaces.name })
    .from(workspaceMemberships).innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(eq(workspaceMemberships.userId, session.user.id)).limit(1);
  if (!membership) throw new AppError(403, "WORKSPACE_ACCESS_DENIED", "当前账号没有工作区访问权限，请联系操作员。");
  return { mode, user: { id: session.user.id, name: session.user.name, email: session.user.email }, workspace: membership, needsLogin: false };
}

// Every HTTP business endpoint awaits this resolver. Workspace/actor never come
// from request bodies or client-supplied resource IDs.
export async function getLocalContext() {
  const status = await getSessionStatus();
  if (status.needsLogin || !status.workspace) throw new AppError(401, "AUTH_REQUIRED", "请先凭邀请登录后继续操作。");
  return { workspaceId: status.workspace.id, actorId: status.user?.id ?? "local-operator" };
}
