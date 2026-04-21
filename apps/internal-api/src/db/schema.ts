import { boolean, index, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const operationsSchema = pgSchema("operations");

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
