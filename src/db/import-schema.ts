import { sql } from "drizzle-orm";
import { check, customType, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { projects } from "./schema";
import { answerEvidence } from "./sampling-schema";
import type { EvidenceAttachment, ManualImportBatch } from "@/lib/import-contracts";

export const manualImportBatches = pgTable("manual_import_batches", {
  id: uuid("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: uuid("project_id").notNull(),
  requestId: uuid("request_id").notNull(), fingerprint: text("fingerprint").notNull(),
  snapshot: jsonb("snapshot").$type<ManualImportBatch>().notNull(), rawContent: text("raw_content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("manual_import_request_unique").on(t.workspaceId, t.projectId, t.requestId),
  foreignKey({ columns: [t.projectId, t.workspaceId], foreignColumns: [projects.id, projects.workspaceId] }),
  index("manual_import_project_idx").on(t.workspaceId, t.projectId, t.createdAt)]);

export const manualSourceKeys = pgTable("manual_source_keys", {
  id: uuid("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: uuid("project_id").notNull(),
  sourceKey: text("source_key").notNull(), payloadHash: text("payload_hash").notNull(), evidenceId: uuid("evidence_id").notNull(),
}, (t) => [unique("manual_source_key_unique").on(t.workspaceId, t.projectId, t.sourceKey),
  foreignKey({ columns: [t.evidenceId, t.projectId, t.workspaceId], foreignColumns: [answerEvidence.id, answerEvidence.projectId, answerEvidence.workspaceId] })]);

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
export const evidenceAttachments = pgTable("evidence_attachments", {
  id: uuid("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: uuid("project_id").notNull(),
  evidenceId: uuid("evidence_id").notNull(), sha256: text("sha256").notNull(), byteLength: integer("byte_length").notNull(),
  snapshot: jsonb("snapshot").$type<EvidenceAttachment>().notNull(), body: bytes("body").notNull(),
}, (t) => [unique("evidence_attachment_content_unique").on(t.evidenceId, t.sha256),
  foreignKey({ columns: [t.evidenceId, t.projectId, t.workspaceId], foreignColumns: [answerEvidence.id, answerEvidence.projectId, answerEvidence.workspaceId] }),
  check("evidence_attachment_size", sql`${t.byteLength} > 0 AND ${t.byteLength} <= 5242880`),
  index("evidence_attachment_scope_idx").on(t.workspaceId, t.projectId, t.evidenceId)]);
