CREATE TABLE "operations"."activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid,
	"blueprint_id" uuid,
	"run_id" uuid,
	"workspace_record_id" uuid,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text,
	"event_kind" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations"."organization_tenants" ADD COLUMN "default_blueprint_id" uuid;--> statement-breakpoint
ALTER TABLE "operations"."activity_events" ADD CONSTRAINT "activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "operations"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."activity_events" ADD CONSTRAINT "activity_events_tenant_id_organization_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "operations"."organization_tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."activity_events" ADD CONSTRAINT "activity_events_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "operations"."blueprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."activity_events" ADD CONSTRAINT "activity_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "operations"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."activity_events" ADD CONSTRAINT "activity_events_workspace_record_id_organization_workspaces_id_fk" FOREIGN KEY ("workspace_record_id") REFERENCES "operations"."organization_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "operations"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "operations"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_actor_user_id_idx" ON "operations"."activity_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "activity_events_blueprint_id_idx" ON "operations"."activity_events" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "activity_events_kind_idx" ON "operations"."activity_events" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "activity_events_organization_id_idx" ON "operations"."activity_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "activity_events_occurred_at_idx" ON "operations"."activity_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_run_id_idx" ON "operations"."activity_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "activity_events_tenant_id_idx" ON "operations"."activity_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "activity_events_workspace_record_id_idx" ON "operations"."activity_events" USING btree ("workspace_record_id");--> statement-breakpoint
CREATE INDEX "run_events_level_idx" ON "operations"."run_events" USING btree ("level");--> statement-breakpoint
CREATE INDEX "run_events_run_id_idx" ON "operations"."run_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_events_step_key_idx" ON "operations"."run_events" USING btree ("step_key");--> statement-breakpoint
CREATE INDEX "organization_tenants_default_blueprint_id_idx" ON "operations"."organization_tenants" USING btree ("default_blueprint_id");