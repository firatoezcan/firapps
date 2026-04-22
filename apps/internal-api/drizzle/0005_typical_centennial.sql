CREATE TABLE "operations"."dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"blueprint_id" uuid,
	"run_id" uuid,
	"requested_by_user_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"requested_by_name" text,
	"requested_by_email" text,
	"request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations"."dispatches" ADD CONSTRAINT "dispatches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "operations"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."dispatches" ADD CONSTRAINT "dispatches_tenant_id_organization_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "operations"."organization_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."dispatches" ADD CONSTRAINT "dispatches_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "operations"."blueprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."dispatches" ADD CONSTRAINT "dispatches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "operations"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."dispatches" ADD CONSTRAINT "dispatches_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "operations"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatches_blueprint_id_idx" ON "operations"."dispatches" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "dispatches_created_at_idx" ON "operations"."dispatches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dispatches_organization_id_idx" ON "operations"."dispatches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dispatches_requested_by_email_idx" ON "operations"."dispatches" USING btree ("requested_by_email");--> statement-breakpoint
CREATE INDEX "dispatches_requested_by_user_id_idx" ON "operations"."dispatches" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "dispatches_run_id_idx" ON "operations"."dispatches" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatches_run_id_unique" ON "operations"."dispatches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "dispatches_source_idx" ON "operations"."dispatches" USING btree ("source");--> statement-breakpoint
CREATE INDEX "dispatches_tenant_id_idx" ON "operations"."dispatches" USING btree ("tenant_id");