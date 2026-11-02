ALTER TABLE "answer_evidence" ADD CONSTRAINT "answer_evidence_scope_unique" UNIQUE("id","project_id","workspace_id");
--> statement-breakpoint
CREATE TABLE "evidence_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"body" "bytea" NOT NULL,
	CONSTRAINT "evidence_attachment_content_unique" UNIQUE("evidence_id","sha256"),
	CONSTRAINT "evidence_attachment_size" CHECK ("evidence_attachments"."byte_length" > 0 AND "evidence_attachments"."byte_length" <= 5242880)
);
--> statement-breakpoint
CREATE TABLE "manual_import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"raw_content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_import_request_unique" UNIQUE("workspace_id","project_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "manual_source_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "manual_source_key_unique" UNIQUE("workspace_id","project_id","source_key")
);
--> statement-breakpoint
ALTER TABLE "evidence_attachments" ADD CONSTRAINT "evidence_attachments_evidence_id_project_id_workspace_id_answer_evidence_id_project_id_workspace_id_fk" FOREIGN KEY ("evidence_id","project_id","workspace_id") REFERENCES "public"."answer_evidence"("id","project_id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_import_batches" ADD CONSTRAINT "manual_import_batches_project_id_workspace_id_projects_id_workspace_id_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_source_keys" ADD CONSTRAINT "manual_source_keys_evidence_id_project_id_workspace_id_answer_evidence_id_project_id_workspace_id_fk" FOREIGN KEY ("evidence_id","project_id","workspace_id") REFERENCES "public"."answer_evidence"("id","project_id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_attachment_scope_idx" ON "evidence_attachments" USING btree ("workspace_id","project_id","evidence_id");--> statement-breakpoint
CREATE INDEX "manual_import_project_idx" ON "manual_import_batches" USING btree ("workspace_id","project_id","created_at");