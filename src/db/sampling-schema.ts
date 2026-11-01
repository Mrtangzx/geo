import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { projects, workspaces } from "./schema";
import type { BudgetReservation, EvidenceRecord, FixtureSeed, SamplingRun, SamplingUnit } from "@/lib/sampling-contracts";

export const fixtureSeeds = pgTable("fixture_seeds", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  manifestId: text("manifest_id").notNull(), projectId: uuid("project_id").notNull(),
  snapshot: jsonb("snapshot").$type<FixtureSeed>().notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.manifestId] }), unique("fixture_seed_project_unique").on(table.projectId),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId] })]);

export const budgetAccounts = pgTable("budget_accounts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id), kind: text("kind").notNull(), currency: text("currency").notNull(),
  limitMinor: integer("limit_minor").notNull().default(0), reservedMinor: integer("reserved_minor").notNull().default(0), spentMinor: integer("spent_minor").notNull().default(0),
  version: integer("version").notNull().default(1), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.kind, table.currency] }),
  check("budget_nonnegative", sql`${table.limitMinor} >= 0 AND ${table.reservedMinor} >= 0 AND ${table.spentMinor} >= 0`),
  check("budget_not_overdrawn", sql`${table.reservedMinor} + ${table.spentMinor} <= ${table.limitMinor}`)]);

export const budgetReservations = pgTable("budget_reservations", {
  id: uuid("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: uuid("project_id").notNull(),
  executionKey: text("execution_key").notNull(), snapshot: jsonb("snapshot").$type<BudgetReservation>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [unique("budget_reservation_execution_unique").on(table.workspaceId, table.executionKey),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId] }), index("budget_reservations_project_idx").on(table.workspaceId, table.projectId)]);

export const samplingRuns = pgTable("sampling_runs", {
  id: uuid("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: uuid("project_id").notNull(),
  executionKey: text("execution_key").notNull(), status: text("status").notNull(), snapshot: jsonb("snapshot").$type<SamplingRun>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [unique("sampling_run_execution_unique").on(table.workspaceId, table.executionKey),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId] }), index("sampling_run_project_idx").on(table.workspaceId, table.projectId)]);

export const samplingUnits = pgTable("sampling_units", {
  id: uuid("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: uuid("project_id").notNull(),
  businessKey: text("business_key").notNull(), status: text("status").notNull(), snapshot: jsonb("snapshot").$type<SamplingUnit>().notNull(),
  rawFixture: jsonb("raw_fixture").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [unique("sampling_unit_business_unique").on(table.workspaceId, table.businessKey),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId] }), index("sampling_unit_project_idx").on(table.workspaceId, table.projectId)]);

export const answerEvidence = pgTable("answer_evidence", {
  id: uuid("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: uuid("project_id").notNull(),
  sourceSampleKey: text("source_sample_key").notNull(), snapshot: jsonb("snapshot").$type<EvidenceRecord>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [unique("answer_evidence_source_unique").on(table.workspaceId, table.projectId, table.sourceSampleKey),
  foreignKey({ columns: [table.projectId, table.workspaceId], foreignColumns: [projects.id, projects.workspaceId] }), index("answer_evidence_project_idx").on(table.workspaceId, table.projectId)]);

export const runUnits = pgTable("sampling_run_units", {
  runId: uuid("run_id").notNull().references(() => samplingRuns.id), unitId: uuid("unit_id").notNull().references(() => samplingUnits.id),
}, (table) => [primaryKey({ columns: [table.runId, table.unitId] })]);

export const runEvidence = pgTable("sampling_run_evidence", {
  runId: uuid("run_id").notNull().references(() => samplingRuns.id), evidenceId: uuid("evidence_id").notNull().references(() => answerEvidence.id),
}, (table) => [primaryKey({ columns: [table.runId, table.evidenceId] })]);
