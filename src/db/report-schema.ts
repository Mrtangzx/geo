import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ReviewReport } from "@/lib/report-contracts";
import { projects } from "./schema";

export const reviewReports = pgTable("review_reports", {
  id: uuid("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<ReviewReport>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "review_reports_workspace_fk" }),
  unique("review_reports_project_version_unique").on(table.projectId, table.version),
  index("review_reports_workspace_project_idx").on(table.workspaceId, table.projectId, table.createdAt),
  check("review_reports_version_positive", sql`${table.version} > 0`),
]);
