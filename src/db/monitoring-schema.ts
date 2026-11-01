import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { MonitoringOccurrence, MonitoringPlan } from "@/lib/monitoring-contracts";
import { projects } from "./schema";

export const monitoringPlans = pgTable("monitoring_plans", {
  id: uuid("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  revision: integer("revision").notNull(),
  state: text("state").notNull(),
  snapshot: jsonb("snapshot").$type<MonitoringPlan>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "monitoring_project_workspace_fk" }),
  index("monitoring_plans_workspace_project_idx").on(table.workspaceId, table.projectId),
  check("monitoring_state_valid", sql`${table.state} IN ('active','paused','cancelled')`),
]);

export const monitoringOccurrences = pgTable("monitoring_occurrences", {
  id: uuid("id").primaryKey(),
  planId: uuid("plan_id").notNull().references(() => monitoringPlans.id),
  workspaceId: text("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  purpose: text("purpose").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  state: text("state").notNull(),
  snapshot: jsonb("snapshot").$type<MonitoringOccurrence>().notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "monitoring_occurrences_workspace_fk" }),
  unique("monitoring_occurrence_slot_unique").on(table.planId, table.purpose, table.scheduledAt),
  index("monitoring_occurrence_due_idx").on(table.state, table.scheduledAt),
  check("monitoring_occurrence_state_valid", sql`${table.state} IN ('planned','dispatched','missed','paused','cancelled','blocked')`),
]);

export const monitoringEvents = pgTable("monitoring_events", {
  id: uuid("id").primaryKey(),
  planId: uuid("plan_id").notNull().references(() => monitoringPlans.id),
  workspaceId: text("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId], name: "monitoring_events_workspace_fk" }),
  index("monitoring_events_plan_idx").on(table.workspaceId, table.planId, table.createdAt),
]);
