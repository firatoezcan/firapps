CREATE TABLE "operations"."blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"scope" text DEFAULT 'system' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"trigger_source" text DEFAULT 'manual' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."organization_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"billing_email" text,
	"billing_plan" text NOT NULL,
	"billing_status" text DEFAULT 'active' NOT NULL,
	"billing_reference" text,
	"repo_provider" text,
	"repo_owner" text,
	"repo_name" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"workflow_mode" text DEFAULT 'blueprint' NOT NULL,
	"seat_limit" integer,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."organization_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text DEFAULT 'daytona' NOT NULL,
	"repo_provider" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"image_flavor" text NOT NULL,
	"nix_packages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"ide_url" text,
	"preview_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."run_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"label" text NOT NULL,
	"step_kind" text DEFAULT 'deterministic' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"details" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"blueprint_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"workspace_record_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"branch_name" text,
	"pr_url" text,
	"result_summary" text,
	"failure_message" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations"."blueprints" ADD CONSTRAINT "blueprints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "operations"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."organization_tenants" ADD CONSTRAINT "organization_tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "operations"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."organization_workspaces" ADD CONSTRAINT "organization_workspaces_tenant_id_organization_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "operations"."organization_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."run_artifacts" ADD CONSTRAINT "run_artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "operations"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "operations"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runs" ADD CONSTRAINT "runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "operations"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runs" ADD CONSTRAINT "runs_tenant_id_organization_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "operations"."organization_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runs" ADD CONSTRAINT "runs_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "operations"."blueprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runs" ADD CONSTRAINT "runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "operations"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."runs" ADD CONSTRAINT "runs_workspace_record_id_organization_workspaces_id_fk" FOREIGN KEY ("workspace_record_id") REFERENCES "operations"."organization_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blueprints_organization_id_idx" ON "operations"."blueprints" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "blueprints_scope_slug_idx" ON "operations"."blueprints" USING btree ("scope","slug");--> statement-breakpoint
CREATE INDEX "organization_tenants_organization_id_idx" ON "operations"."organization_tenants" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_tenants_org_slug_unique" ON "operations"."organization_tenants" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "organization_workspaces_tenant_id_idx" ON "operations"."organization_workspaces" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_workspaces_workspace_id_unique" ON "operations"."organization_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "run_artifacts_artifact_type_idx" ON "operations"."run_artifacts" USING btree ("artifact_type");--> statement-breakpoint
CREATE INDEX "run_artifacts_run_id_idx" ON "operations"."run_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_steps_run_position_unique" ON "operations"."run_steps" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "run_steps_run_id_idx" ON "operations"."run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_organization_id_idx" ON "operations"."runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "runs_tenant_id_idx" ON "operations"."runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "runs_requested_by_user_id_idx" ON "operations"."runs" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "operations"."runs" USING btree ("status");