import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./schema";
import type { ModificationTask } from "@/lib/task-contracts";

export const modificationTasks = pgTable("modification_tasks", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  revision: integer("revision").notNull(),
  snapshot: jsonb("snapshot").$type<ModificationTask>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("modification_tasks_id_workspace_unique").on(table.id, table.workspaceId),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "modification_tasks_project_workspace_fk" }),
  index("modification_tasks_project_idx").on(table.workspaceId, table.projectId),
  check("modification_tasks_revision_positive", sql`${table.revision} > 0`),
]);

export const modificationTaskEvents = pgTable("modification_task_events", {
  taskId: uuid("task_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  revision: integer("revision").notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id").notNull(),
  snapshot: jsonb("snapshot").$type<ModificationTask>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.revision] }),
  foreignKey({ columns: [table.taskId, table.workspaceId], foreignColumns: [modificationTasks.id, modificationTasks.workspaceId], name: "modification_task_events_workspace_fk" }),
]);
