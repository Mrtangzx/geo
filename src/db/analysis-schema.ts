import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { projects } from "./schema";
import type { EvidenceAnalysis, MetricsSnapshot } from "@/lib/analysis-contracts";

export const evidenceAnalyses = pgTable("evidence_analyses", {
  id: uuid("id").primaryKey(), projectId: uuid("project_id").notNull(), workspaceId: text("workspace_id").notNull(),
  evidenceId: uuid("evidence_id").notNull(), revision: integer("revision").notNull(),
  status: text("status").notNull(), mode: text("mode").notNull(),
  snapshot: jsonb("snapshot").$type<EvidenceAnalysis>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "evidence_analyses_project_workspace_fk" }),
  unique("evidence_analyses_evidence_revision_unique").on(table.evidenceId, table.revision),
  index("evidence_analyses_workspace_project_idx").on(table.workspaceId, table.projectId, table.evidenceId),
  check("evidence_analyses_revision_positive", sql`${table.revision} > 0`),
]);

export const metricsSnapshots = pgTable("metrics_snapshots", {
  id: uuid("id").primaryKey(), projectId: uuid("project_id").notNull(), workspaceId: text("workspace_id").notNull(),
  snapshot: jsonb("snapshot").$type<MetricsSnapshot>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "metrics_snapshots_project_workspace_fk" }),
  index("metrics_snapshots_workspace_project_idx").on(table.workspaceId, table.projectId, table.createdAt),
]);
