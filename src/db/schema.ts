import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { Project } from "@/lib/contracts";

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Project>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("projects_id_workspace_unique").on(table.id, table.workspaceId),
    index("projects_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    check("projects_version_positive", sql`${table.version} > 0`),
    check("projects_competitor_limit", sql`jsonb_array_length(${table.snapshot}->'competitors') <= 3`),
  ],
);

export const projectVersions = pgTable(
  "project_versions",
  {
    projectId: uuid("project_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Project>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.version] }),
    foreignKey({
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
      name: "project_versions_project_workspace_fk",
    }),
    index("project_versions_workspace_idx").on(table.workspaceId, table.projectId),
    check("project_versions_version_positive", sql`${table.version} > 0`),
  ],
);
