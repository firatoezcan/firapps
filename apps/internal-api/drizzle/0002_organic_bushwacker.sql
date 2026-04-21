CREATE TABLE "operations"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"active_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "operations"."verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" DROP CONSTRAINT "organization_invitations_token_unique";--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" DROP CONSTRAINT "organization_invitations_invited_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" ALTER COLUMN "invited_by_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "operations"."organization_memberships" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "operations"."organizations" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "operations"."organizations" ADD COLUMN "metadata" text;--> statement-breakpoint
ALTER TABLE "operations"."users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "operations"."users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "operations"."users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "operations"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "operations"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "operations"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_unique" ON "operations"."accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "operations"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "operations"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "operations"."verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "operations"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_invitations_email_idx" ON "operations"."organization_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "organization_invitations_inviter_id_idx" ON "operations"."organization_invitations" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_invitations_organization_id_idx" ON "operations"."organization_invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_id_idx" ON "operations"."organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_organization_id_idx" ON "operations"."organization_memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_org_user_unique" ON "operations"."organization_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "operations"."organization_invitations" DROP COLUMN "accepted_at";