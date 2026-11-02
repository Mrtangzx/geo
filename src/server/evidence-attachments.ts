import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { answerEvidence } from "@/db/sampling-schema";
import { evidenceAttachments } from "@/db/import-schema";
import { projects } from "@/db/schema";
import type { EvidenceAttachment } from "@/lib/import-contracts";
import type { EvidenceRecord } from "@/lib/sampling-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const attachmentInputSchema = z.object({ filename: z.string().trim().min(1).max(160), contentType: z.enum(["image/png", "image/jpeg"]), dataBase64: z.string().min(1).max(7 * 1024 * 1024) }).strict();

async function assertEvidence(workspaceId: string, projectId: string, evidenceId: string) {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ id: answerEvidence.id }).from(answerEvidence).where(and(eq(answerEvidence.id, evidenceId), eq(answerEvidence.workspaceId, workspaceId), eq(answerEvidence.projectId, projectId)));
  if (!row) throw new AppError(404, "EVIDENCE_NOT_FOUND", "未找到该回答证据。");
}
export async function enrichEvidenceAttachments(records: EvidenceRecord[]): Promise<EvidenceRecord[]> {
  if (!records.length) return records;
  const first = records[0];
  const rows = await getDatabase().select({ evidenceId: evidenceAttachments.evidenceId, snapshot: evidenceAttachments.snapshot }).from(evidenceAttachments)
    .where(and(eq(evidenceAttachments.workspaceId, first.workspaceId), eq(evidenceAttachments.projectId, first.projectId), inArray(evidenceAttachments.evidenceId, records.map((r) => r.id))));
  return records.map((record) => ({ ...record, attachments: rows.filter((r) => r.evidenceId === record.id).map((r) => r.snapshot) }));
}
export async function listEvidenceAttachments(workspaceId: string, projectId: string, evidenceId: string) {
  await assertEvidence(workspaceId, projectId, evidenceId);
  return (await getDatabase().select({ snapshot: evidenceAttachments.snapshot }).from(evidenceAttachments)
    .where(and(eq(evidenceAttachments.workspaceId, workspaceId), eq(evidenceAttachments.projectId, projectId), eq(evidenceAttachments.evidenceId, evidenceId)))).map((r) => r.snapshot);
}
export async function getEvidenceAttachment(workspaceId: string, projectId: string, evidenceId: string, attachmentId: string) {
  await assertEvidence(workspaceId, projectId, evidenceId);
  const [row] = await getDatabase().select().from(evidenceAttachments).where(and(eq(evidenceAttachments.workspaceId, workspaceId), eq(evidenceAttachments.projectId, projectId), eq(evidenceAttachments.evidenceId, evidenceId), eq(evidenceAttachments.id, attachmentId)));
  if (!row) throw new AppError(404, "ATTACHMENT_NOT_FOUND", "未找到该截图。");
  return { metadata: row.snapshot, body: row.body };
}
export async function addEvidenceAttachment(workspaceId: string, actorId: string, projectId: string, evidenceId: string, input: z.infer<typeof attachmentInputSchema>): Promise<EvidenceAttachment> {
  await assertEvidence(workspaceId, projectId, evidenceId);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)) throw new AppError(400, "ATTACHMENT_ENCODING", "截图编码无效。");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new AppError(413, "ATTACHMENT_SIZE", "每张截图最多5MB。");
  if (bytes.toString("base64") !== input.dataBase64) throw new AppError(400, "ATTACHMENT_ENCODING", "截图编码不完整。");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(input.contentType === "image/png" ? png : jpeg)) throw new AppError(415, "ATTACHMENT_TYPE", "只接受实际内容为PNG或JPEG的截图，不执行或保存网页脚本附件。");
  let normalized: Buffer; let width: number; let height: number;
  try {
    const image = sharp(bytes, { limitInputPixels: 16000000, failOn: "warning" });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height) throw new Error("not a single image");
    const result = await image.rotate().png().timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
    normalized = result.data; width = result.info.width; height = result.info.height;
  } catch { throw new AppError(400, "ATTACHMENT_DECODE", "截图无法完整解码、尺寸超过1600万像素或包含多帧；未写入附件。"); }
  if (normalized.length > MAX_ATTACHMENT_BYTES) throw new AppError(413, "ATTACHMENT_SIZE", "截图转为无元数据PNG后超过5MB，请提供较小截图。");
  const sha256 = createHash("sha256").update(normalized).digest("hex");
  return getDatabase().transaction(async (tx) => {
    await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).for("update");
    const existing = await tx.select({ snapshot: evidenceAttachments.snapshot }).from(evidenceAttachments).where(and(eq(evidenceAttachments.workspaceId, workspaceId), eq(evidenceAttachments.projectId, projectId), eq(evidenceAttachments.evidenceId, evidenceId)));
    const prior = existing.find((r) => r.snapshot.sha256 === sha256);
    if (prior) return prior.snapshot;
    if (existing.length >= 3) throw new AppError(409, "ATTACHMENT_LIMIT", "每条回答最多保存3张不同截图；重复截图会复用，不占新位置。");
    const filename = (input.filename.replace(/\\/g, "/").split("/").at(-1) ?? "截图").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120) || "截图";
    const snapshot: EvidenceAttachment = { id: randomUUID(), evidenceId, filename, contentType: "image/png", byteLength: normalized.length, sha256, width, height, uploadedAt: new Date().toISOString(), uploadedBy: actorId };
    await tx.insert(evidenceAttachments).values({ id: snapshot.id, workspaceId, projectId, evidenceId, sha256, byteLength: normalized.length, snapshot, body: normalized });
    return snapshot;
  });
}
