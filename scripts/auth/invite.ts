import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { getDatabase, getPool } from "../../src/db/client";
import { authUser, invitations } from "../../src/db/auth-schema";
import { workspaces } from "../../src/db/schema";
import { getInviteAuthConfig } from "../../src/server/auth-config";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const email = value("--email")?.trim().toLowerCase();
  const workspaceName = value("--workspace-name")?.trim();
  const requestedWorkspace = value("--workspace-id");
  const hours = Number(value("--expires-hours") ?? "72");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || !Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error("Usage: npm run auth:invite -- --email person@example.com [--workspace-name 企业工作区] [--workspace-id existing-id] [--expires-hours 72]");
  }
  const { baseURL } = getInviteAuthConfig();
  const db = getDatabase();
  const id = randomUUID();
  const rawToken = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  let workspaceId = requestedWorkspace;
  await db.transaction(async (tx) => {
    const [existingUser] = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email)).limit(1);
    if (existingUser) throw new Error("The email already has an account. Workspace membership must be handled explicitly by an operator.");
    if (workspaceId) {
      const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!workspace) throw new Error("Requested workspace does not exist. No invitation was issued.");
    } else {
      workspaceId = `workspace-${randomUUID()}`;
      await tx.insert(workspaces).values({ id: workspaceId, name: workspaceName || `${email.split("@")[0]}的工作区` });
    }
    await tx.insert(invitations).values({ id, tokenHash: createHash("sha256").update(rawToken).digest("hex"), email, workspaceId: workspaceId!, expiresAt });
  });
  const directory = path.resolve(".local/invitations");
  await mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, `${id}.json`);
  await writeFile(outputPath, JSON.stringify({ email, workspaceId, expiresAt: expiresAt.toISOString(), url: `${baseURL}/login#invite=${rawToken}` }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ issued: true, email, workspaceId, expiresAt: expiresAt.toISOString(), privateInvitationFile: outputPath }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  console.error(/^(Usage:|The email already|Requested workspace)/.test(message) ? message : "Invitation issuance failed. Check authentication configuration, database and migrations.");
  process.exitCode = 1;
}).finally(async () => { try { await getPool().end(); } catch { /* No pool is created when configuration is missing. */ } });
