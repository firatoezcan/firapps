CREATE TABLE "operations"."runner_job_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."runner_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"runner_id" uuid,
	"event_kind" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."runner_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"runner_id" uuid,
	"session_id" uuid,
	"run_id" uuid,
	"requested_by_user_id" uuid,
	"operation" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_message" text,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."runner_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"api_key_hash" text NOT NULL,
	"api_key_preview" text NOT NULL,
	"allowed_operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"repository_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capability_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"protocol_version" text,
	"runner_version" text,
	"image_digest" text,
	"last_heartbeat_at" timestamp with time zone,
	"api_key_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."runner_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"protocol_version" text NOT NULL,
	"runner_version" text,
	"image_digest" text,
	"host_capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_concurrency" integer DEFAULT 0 NOT NULL,
	"cleanup_state" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations"."runner_job_artifacts" ADD CONSTRAINT "runner_job_artifacts_job_id_runner_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "operations"."runner_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_job_events" ADD CONSTRAINT "runner_job_events_job_id_runner_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "operations"."runner_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_job_events" ADD CONSTRAINT "runner_job_events_runner_id_runner_registrations_id_fk" FOREIGN KEY ("runner_id") REFERENCES "operations"."runner_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_jobs" ADD CONSTRAINT "runner_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "operations"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_jobs" ADD CONSTRAINT "runner_jobs_tenant_id_organization_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "operations"."organization_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_jobs" ADD CONSTRAINT "runner_jobs_runner_id_runner_registrations_id_fk" FOREIGN KEY ("runner_id") REFERENCES "operations"."runner_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_jobs" ADD CONSTRAINT "runner_jobs_session_id_runner_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "operations"."runner_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_jobs" ADD CONSTRAINT "runner_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "operations"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_jobs" ADD CONSTRAINT "runner_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "operations"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_registrations" ADD CONSTRAINT "runner_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "operations"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_registrations" ADD CONSTRAINT "runner_registrations_tenant_id_organization_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "operations"."organization_tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_registrations" ADD CONSTRAINT "runner_registrations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "operations"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runner_sessions" ADD CONSTRAINT "runner_sessions_runner_id_runner_registrations_id_fk" FOREIGN KEY ("runner_id") REFERENCES "operations"."runner_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runner_job_artifacts_artifact_type_idx" ON "operations"."runner_job_artifacts" USING btree ("artifact_type");--> statement-breakpoint
CREATE INDEX "runner_job_artifacts_job_id_idx" ON "operations"."runner_job_artifacts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "runner_job_events_job_id_idx" ON "operations"."runner_job_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "runner_job_events_runner_id_idx" ON "operations"."runner_job_events" USING btree ("runner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_jobs_idempotency_unique" ON "operations"."runner_jobs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "runner_jobs_organization_id_idx" ON "operations"."runner_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "runner_jobs_runner_id_idx" ON "operations"."runner_jobs" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "runner_jobs_run_id_idx" ON "operations"."runner_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runner_jobs_status_idx" ON "operations"."runner_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runner_jobs_tenant_id_idx" ON "operations"."runner_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_registrations_api_key_hash_unique" ON "operations"."runner_registrations" USING btree ("api_key_hash");--> statement-breakpoint
CREATE INDEX "runner_registrations_organization_id_idx" ON "operations"."runner_registrations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "runner_registrations_status_idx" ON "operations"."runner_registrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runner_registrations_tenant_id_idx" ON "operations"."runner_registrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "runner_sessions_runner_id_idx" ON "operations"."runner_sessions" USING btree ("runner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_sessions_token_hash_unique" ON "operations"."runner_sessions" USING btree ("token_hash");