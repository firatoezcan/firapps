import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const operationsSchema = pgSchema("operations");

export type BlueprintStepDefinition = {
  key: string;
  kind: "agentic" | "deterministic";
  label: string;
};

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type RunArtifactMetadata = Record<string, boolean | number | string | null>;
export type RunEventMetadata = Record<string, boolean | number | string | null>;
export type ActivityEventMetadata = Record<string, boolean | number | string | null>;
export type DispatchMetadata = Record<string, JsonValue>;

export const tenants = operationsSchema.table("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = operationsSchema.table("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = operationsSchema.table("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMemberships = operationsSchema.table(
  "organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIndex: index("organization_memberships_user_id_idx").on(table.userId),
    organizationIdIndex: index("organization_memberships_organization_id_idx").on(
      table.organizationId,
    ),
    organizationUserUnique: uniqueIndex("organization_memberships_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

export const organizationInvitations = operationsSchema.table(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    inviterId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIndex: index("organization_invitations_email_idx").on(table.email),
    inviterIdIndex: index("organization_invitations_inviter_id_idx").on(table.inviterId),
    organizationIdIndex: index("organization_invitations_organization_id_idx").on(
      table.organizationId,
    ),
  }),
);

export const sessions = operationsSchema.table(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: uuid("active_organization_id"),
    activeTeamId: uuid("active_team_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIndex: index("sessions_user_id_idx").on(table.userId),
  }),
);

export const accounts = operationsSchema.table(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerAccountUnique: uniqueIndex("accounts_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
    userIdIndex: index("accounts_user_id_idx").on(table.userId),
  }),
);

export const verifications = operationsSchema.table(
  "verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identifierIndex: index("verifications_identifier_idx").on(table.identifier),
  }),
);

export const deployments = operationsSchema.table("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  environment: text("environment").notNull(),
  version: text("version").notNull(),
  status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationTenants = operationsSchema.table(
  "organization_tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    defaultBlueprintId: uuid("default_blueprint_id"),
    billingEmail: text("billing_email"),
    billingPlan: text("billing_plan").notNull(),
    billingStatus: text("billing_status").notNull().default("active"),
    billingReference: text("billing_reference"),
    repoProvider: text("repo_provider"),
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    defaultBranch: text("default_branch").notNull().default("main"),
    workflowMode: text("workflow_mode").notNull().default("blueprint"),
    seatLimit: integer("seat_limit"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    defaultBlueprintIdIndex: index("organization_tenants_default_blueprint_id_idx").on(
      table.defaultBlueprintId,
    ),
    organizationIdIndex: index("organization_tenants_organization_id_idx").on(table.organizationId),
    organizationSlugUnique: uniqueIndex("organization_tenants_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
  }),
);

export const organizationWorkspaces = operationsSchema.table(
  "organization_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizationTenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull().default("daytona"),
    repoProvider: text("repo_provider").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    imageFlavor: text("image_flavor").notNull(),
    nixPackages: jsonb("nix_packages")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("provisioning"),
    ideUrl: text("ide_url"),
    previewUrl: text("preview_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdIndex: index("organization_workspaces_tenant_id_idx").on(table.tenantId),
    workspaceIdUnique: uniqueIndex("organization_workspaces_workspace_id_unique").on(
      table.workspaceId,
    ),
  }),
);

export const blueprints = operationsSchema.table(
  "blueprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    scope: text("scope").notNull().default("system"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    triggerSource: text("trigger_source").notNull().default("manual"),
    steps: jsonb("steps")
      .$type<BlueprintStepDefinition[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIndex: index("blueprints_organization_id_idx").on(table.organizationId),
    scopeSlugIndex: index("blueprints_scope_slug_idx").on(table.scope, table.slug),
  }),
);

export const runs = operationsSchema.table(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizationTenants.id, { onDelete: "cascade" }),
    blueprintId: uuid("blueprint_id").references(() => blueprints.id, {
      onDelete: "set null",
    }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceRecordId: uuid("workspace_record_id").references(() => organizationWorkspaces.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("manual"),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    status: text("status").notNull().default("queued"),
    branchName: text("branch_name"),
    prUrl: text("pr_url"),
    resultSummary: text("result_summary"),
    failureMessage: text("failure_message"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIndex: index("runs_organization_id_idx").on(table.organizationId),
    tenantIdIndex: index("runs_tenant_id_idx").on(table.tenantId),
    requestedByUserIdIndex: index("runs_requested_by_user_id_idx").on(table.requestedByUserId),
    statusIndex: index("runs_status_idx").on(table.status),
  }),
);

export const dispatches = operationsSchema.table(
  "dispatches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizationTenants.id, { onDelete: "cascade" }),
    blueprintId: uuid("blueprint_id").references(() => blueprints.id, {
      onDelete: "set null",
    }),
    runId: uuid("run_id").references(() => runs.id, {
      onDelete: "set null",
    }),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("manual"),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    requestedByName: text("requested_by_name"),
    requestedByEmail: text("requested_by_email"),
    requestPayload: jsonb("request_payload")
      .$type<DispatchMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceMetadata: jsonb("source_metadata")
      .$type<DispatchMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    blueprintIdIndex: index("dispatches_blueprint_id_idx").on(table.blueprintId),
    createdAtIndex: index("dispatches_created_at_idx").on(table.createdAt),
    organizationIdIndex: index("dispatches_organization_id_idx").on(table.organizationId),
    requestedByEmailIndex: index("dispatches_requested_by_email_idx").on(table.requestedByEmail),
    requestedByUserIdIndex: index("dispatches_requested_by_user_id_idx").on(
      table.requestedByUserId,
    ),
    runIdIndex: index("dispatches_run_id_idx").on(table.runId),
    runIdUnique: uniqueIndex("dispatches_run_id_unique").on(table.runId),
    sourceIndex: index("dispatches_source_idx").on(table.source),
    tenantIdIndex: index("dispatches_tenant_id_idx").on(table.tenantId),
  }),
);

export const runSteps = operationsSchema.table(
  "run_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    label: text("label").notNull(),
    stepKind: text("step_kind").notNull().default("deterministic"),
    status: text("status").notNull().default("queued"),
    details: text("details"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    positionUnique: uniqueIndex("run_steps_run_position_unique").on(table.runId, table.position),
    runIdIndex: index("run_steps_run_id_idx").on(table.runId),
  }),
);

export const runArtifacts = operationsSchema.table(
  "run_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    url: text("url"),
    metadata: jsonb("metadata")
      .$type<RunArtifactMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    artifactTypeIndex: index("run_artifacts_artifact_type_idx").on(table.artifactType),
    runIdIndex: index("run_artifacts_run_id_idx").on(table.runId),
  }),
);

export const runEvents = operationsSchema.table(
  "run_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stepKey: text("step_key"),
    eventKind: text("event_kind").notNull(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    metadata: jsonb("metadata")
      .$type<RunEventMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    levelIndex: index("run_events_level_idx").on(table.level),
    runIdIndex: index("run_events_run_id_idx").on(table.runId),
    stepKeyIndex: index("run_events_step_key_idx").on(table.stepKey),
  }),
);

export const activityEvents = operationsSchema.table(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => organizationTenants.id, {
      onDelete: "set null",
    }),
    blueprintId: uuid("blueprint_id").references(() => blueprints.id, {
      onDelete: "set null",
    }),
    runId: uuid("run_id").references(() => runs.id, {
      onDelete: "set null",
    }),
    workspaceRecordId: uuid("workspace_record_id").references(() => organizationWorkspaces.id, {
      onDelete: "set null",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("completed"),
    metadata: jsonb("metadata")
      .$type<ActivityEventMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorUserIdIndex: index("activity_events_actor_user_id_idx").on(table.actorUserId),
    blueprintIdIndex: index("activity_events_blueprint_id_idx").on(table.blueprintId),
    kindIndex: index("activity_events_kind_idx").on(table.kind),
    organizationIdIndex: index("activity_events_organization_id_idx").on(table.organizationId),
    occurredAtIndex: index("activity_events_occurred_at_idx").on(table.occurredAt),
    runIdIndex: index("activity_events_run_id_idx").on(table.runId),
    tenantIdIndex: index("activity_events_tenant_id_idx").on(table.tenantId),
    workspaceRecordIdIndex: index("activity_events_workspace_record_id_idx").on(
      table.workspaceRecordId,
    ),
  }),
);

export const betterAuthSchema = {
  account: accounts,
  accounts,
  invitation: organizationInvitations,
  member: organizationMemberships,
  organization: organizations,
  organization_invitations: organizationInvitations,
  organization_memberships: organizationMemberships,
  organizations,
  session: sessions,
  sessions,
  user: users,
  users,
  verification: verifications,
  verifications,
};
