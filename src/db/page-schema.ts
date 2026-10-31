import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { projects } from "./schema";
import type { PageCollection, PageSnapshot } from "@/lib/page-contracts";

export const pageCollections = pgTable("page_collections", {
  projectId: uuid("project_id").notNull().primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<PageCollection>().notNull(),
  checkToken: uuid("check_token"),
  checkExpiresAt: timestamp("check_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "page_collections_project_workspace_fk" }),
  index("page_collections_workspace_idx").on(table.workspaceId, table.projectId),
  check("page_collections_version_positive", sql`${table.version} > 0`),
  check("page_collections_page_limit", sql`jsonb_array_length(${table.snapshot}->'pages') <= 10`),
]);

export const pageCollectionVersions = pgTable("page_collection_versions", {
  projectId: uuid("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<PageCollection>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.version] }),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "page_collection_versions_project_workspace_fk" }),
  index("page_collection_versions_workspace_idx").on(table.workspaceId, table.projectId),
]);

export const pageSnapshots = pgTable("page_snapshots", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  pageId: uuid("page_id").notNull(),
  revision: integer("revision").notNull(),
  status: text("status").notNull(),
  snapshot: jsonb("snapshot").$type<PageSnapshot>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "page_snapshots_project_workspace_fk" }),
  unique("page_snapshots_page_revision_unique").on(table.projectId, table.pageId, table.revision),
  index("page_snapshots_workspace_page_idx").on(table.workspaceId, table.projectId, table.pageId),
  check("page_snapshots_revision_positive", sql`${table.revision} > 0`),
  check("page_snapshots_status_valid", sql`${table.status} IN ('running','success','http_error','blocked','failed')`),
]);
