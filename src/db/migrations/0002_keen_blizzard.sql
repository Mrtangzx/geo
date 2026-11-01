CREATE TABLE "evidence_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evidence_analyses_evidence_revision_unique" UNIQUE("evidence_id","revision"),
	CONSTRAINT "evidence_analyses_revision_positive" CHECK ("evidence_analyses"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "metrics_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_occurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "monitoring_occurrence_slot_unique" UNIQUE("plan_id","purpose","scheduled_at"),
	CONSTRAINT "monitoring_occurrence_state_valid" CHECK ("monitoring_occurrences"."state" IN ('planned','dispatched','missed','paused','cancelled','blocked'))
);
--> statement-breakpoint
CREATE TABLE "monitoring_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"state" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "monitoring_state_valid" CHECK ("monitoring_plans"."state" IN ('active','paused','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_reports_project_version_unique" UNIQUE("project_id","version"),
	CONSTRAINT "review_reports_version_positive" CHECK ("review_reports"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "answer_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"source_sample_key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "answer_evidence_source_unique" UNIQUE("workspace_id","project_id","source_sample_key")
);
--> statement-breakpoint
CREATE TABLE "budget_accounts" (
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"limit_minor" integer DEFAULT 0 NOT NULL,
	"reserved_minor" integer DEFAULT 0 NOT NULL,
	"spent_minor" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_accounts_workspace_id_kind_currency_pk" PRIMARY KEY("workspace_id","kind","currency"),
	CONSTRAINT "budget_nonnegative" CHECK ("budget_accounts"."limit_minor" >= 0 AND "budget_accounts"."reserved_minor" >= 0 AND "budget_accounts"."spent_minor" >= 0),
	CONSTRAINT "budget_not_overdrawn" CHECK ("budget_accounts"."reserved_minor" + "budget_accounts"."spent_minor" <= "budget_accounts"."limit_minor")
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"execution_key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "budget_reservation_execution_unique" UNIQUE("workspace_id","execution_key")
);
--> statement-breakpoint
CREATE TABLE "fixture_seeds" (
	"workspace_id" text NOT NULL,
	"manifest_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "fixture_seeds_workspace_id_manifest_id_pk" PRIMARY KEY("workspace_id","manifest_id"),
	CONSTRAINT "fixture_seed_project_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "sampling_run_evidence" (
	"run_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "sampling_run_evidence_run_id_evidence_id_pk" PRIMARY KEY("run_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "sampling_run_units" (
	"run_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	CONSTRAINT "sampling_run_units_run_id_unit_id_pk" PRIMARY KEY("run_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "sampling_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"execution_key" text NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sampling_run_execution_unique" UNIQUE("workspace_id","execution_key")
);
--> statement-breakpoint
CREATE TABLE "sampling_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"business_key" text NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"raw_fixture" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sampling_unit_business_unique" UNIQUE("workspace_id","business_key")
);
--> statement-breakpoint
CREATE TABLE "modification_task_events" (
	"task_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "modification_task_events_task_id_revision_pk" PRIMARY KEY("task_id","revision")
);
--> statement-breakpoint
CREATE TABLE "modification_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "modification_tasks_id_workspace_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "modification_tasks_revision_positive" CHECK ("modification_tasks"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "evidence_analyses" ADD CONSTRAINT "evidence_analyses_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_snapshots" ADD CONSTRAINT "metrics_snapshots_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_plan_id_monitoring_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."monitoring_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_occurrences" ADD CONSTRAINT "monitoring_occurrences_plan_id_monitoring_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."monitoring_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_occurrences" ADD CONSTRAINT "monitoring_occurrences_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_plans" ADD CONSTRAINT "monitoring_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_evidence" ADD CONSTRAINT "answer_evidence_project_id_workspace_id_projects_id_workspace_id_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_accounts" ADD CONSTRAINT "budget_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_project_id_workspace_id_projects_id_workspace_id_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_seeds" ADD CONSTRAINT "fixture_seeds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_seeds" ADD CONSTRAINT "fixture_seeds_project_id_workspace_id_projects_id_workspace_id_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_run_evidence" ADD CONSTRAINT "sampling_run_evidence_run_id_sampling_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sampling_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_run_evidence" ADD CONSTRAINT "sampling_run_evidence_evidence_id_answer_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."answer_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_run_units" ADD CONSTRAINT "sampling_run_units_run_id_sampling_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sampling_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_run_units" ADD CONSTRAINT "sampling_run_units_unit_id_sampling_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."sampling_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_runs" ADD CONSTRAINT "sampling_runs_project_id_workspace_id_projects_id_workspace_id_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_units" ADD CONSTRAINT "sampling_units_project_id_workspace_id_projects_id_workspace_id_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification_task_events" ADD CONSTRAINT "modification_task_events_workspace_fk" FOREIGN KEY ("task_id","workspace_id") REFERENCES "public"."modification_tasks"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification_tasks" ADD CONSTRAINT "modification_tasks_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_analyses_workspace_project_idx" ON "evidence_analyses" USING btree ("workspace_id","project_id","evidence_id");--> statement-breakpoint
CREATE INDEX "metrics_snapshots_workspace_project_idx" ON "metrics_snapshots" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "monitoring_events_plan_idx" ON "monitoring_events" USING btree ("workspace_id","plan_id","created_at");--> statement-breakpoint
CREATE INDEX "monitoring_occurrence_due_idx" ON "monitoring_occurrences" USING btree ("state","scheduled_at");--> statement-breakpoint
CREATE INDEX "monitoring_plans_workspace_project_idx" ON "monitoring_plans" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "review_reports_workspace_project_idx" ON "review_reports" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "answer_evidence_project_idx" ON "answer_evidence" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "budget_reservations_project_idx" ON "budget_reservations" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "sampling_run_project_idx" ON "sampling_runs" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "sampling_unit_project_idx" ON "sampling_units" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "modification_tasks_project_idx" ON "modification_tasks" USING btree ("workspace_id","project_id");