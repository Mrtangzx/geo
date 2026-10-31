import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { QuestionSet, QuestionSetVersion } from "@/lib/question-contracts";
import { projects } from "./schema";

export const questionSets = pgTable("question_sets", {
  projectId: uuid("project_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  revision: integer("revision").notNull(),
  snapshot: jsonb("snapshot").$type<QuestionSet>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "question_sets_project_workspace_fk" }),
  index("question_sets_workspace_idx").on(table.workspaceId),
  check("question_sets_revision_positive", sql`${table.revision} > 0`),
  check("question_sets_question_limit", sql`jsonb_array_length(${table.snapshot}->'questions') <= 20`),
]);

export const questionSetVersions = pgTable("question_set_versions", {
  projectId: uuid("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<QuestionSetVersion>().notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.version] }),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "question_versions_project_workspace_fk" }),
  index("question_versions_workspace_idx").on(table.workspaceId, table.projectId),
  check("question_versions_version_positive", sql`${table.version} > 0`),
  check("question_versions_nonempty", sql`jsonb_array_length(${table.snapshot}->'questions') BETWEEN 1 AND 20`),
]);
