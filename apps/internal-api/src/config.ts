import { z } from "zod";

import { readServiceEnv } from "@firapps/backend-common";

const defaultDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/firapps";
const defaultAllowedOrigins = [
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:3000",
  "http://localhost:3001",
].join(",");

process.env.APP_NAME ??= "internal-api";
process.env.PORT ??= "4001";
process.env.DATABASE_URL ??= defaultDatabaseUrl;
process.env.DATABASE_SCHEMA ??= "operations";
process.env.DATABASE_MIGRATIONS_TABLE ??= "__drizzle_internal_api_migrations";
process.env.API_PREFIX ??= "/api/internal";
process.env.AUTH_BASE_URL ??= "http://localhost:4001";
process.env.CUSTOMER_WEB_URL ??= "http://localhost:3000";
process.env.ADMIN_WEB_URL ??= "http://localhost:3001";
process.env.ALLOWED_ORIGINS ??= defaultAllowedOrigins;
process.env.BETTER_AUTH_SECRET ??=
  "devboxes-local-better-auth-secret-2026-04-21-keep-this-overridden";
process.env.GITHUB_API_BASE_URL ??= "https://api.github.com";
process.env.OPERATOR_EMAIL_ALLOWLIST ??= "@operator.local";
process.env.PLATFORM_PROVISIONER_TIMEOUT_MS ??= "10000";
process.env.PLATFORM_PROVISIONER_EXECUTION_TIMEOUT_MS ??= "600000";
process.env.RUN_RECONCILE_INTERVAL_MS ??= "5000";
process.env.RUN_WORKSPACE_RETENTION_MS ??= "60000";
process.env.DISPATCH_WEBHOOK_SECRET ??= "devboxes-local-dispatch-webhook-secret-2026-04-22";

export const internalApiEnv = readServiceEnv(
  z.object({
    API_PREFIX: z.string().default("/api/internal"),
    DATABASE_URL: z.string().min(1).default(defaultDatabaseUrl),
    DATABASE_SCHEMA: z.string().default("operations"),
    DATABASE_MIGRATIONS_TABLE: z.string().default("__drizzle_internal_api_migrations"),
    AUTH_BASE_URL: z.string().url().default("http://localhost:4001"),
    CUSTOMER_WEB_URL: z.string().url().default("http://localhost:3000"),
    ADMIN_WEB_URL: z.string().url().default("http://localhost:3001"),
    ALLOWED_ORIGINS: z.string().default(defaultAllowedOrigins),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    DISPATCH_WEBHOOK_SECRET: z.string().min(1),
    GITHUB_API_BASE_URL: z.string().url().default("https://api.github.com"),
    GITHUB_TOKEN: z.string().min(1).optional(),
    MAILPIT_API_URL: z.string().url().optional(),
    OPERATOR_EMAIL_ALLOWLIST: z.string().default(""),
    PLATFORM_PROVISIONER_BASE_URL: z.string().url().optional(),
    PLATFORM_PROVISIONER_SHARED_SECRET: z.string().min(1).optional(),
    PLATFORM_PROVISIONER_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    PLATFORM_PROVISIONER_EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
    RUN_RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    RUN_WORKSPACE_RETENTION_MS: z.coerce.number().int().nonnegative().default(60000),
  }),
);

export function listAllowedOrigins(csv = internalApiEnv.ALLOWED_ORIGINS) {
  return csv
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function listOperatorEmails(csv = internalApiEnv.OPERATOR_EMAIL_ALLOWLIST) {
  return csv
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

function matchesOperatorEmailEntry(email: string, entry: string) {
  return entry.startsWith("@") ? email.endsWith(entry) : email === entry;
}

export function isOperatorEmailAllowed(
  email: string,
  csv = internalApiEnv.OPERATOR_EMAIL_ALLOWLIST,
) {
  return operatorEmailAllowed(email, listOperatorEmails(csv));
}

function wildcardPatternToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");

  return new RegExp(`^${escaped}$`, "i");
}

export function operatorEmailAllowed(email: string, patterns = listOperatorEmails()) {
  const normalizedEmail = email.trim().toLowerCase();

  return patterns.some((pattern) => {
    if (matchesOperatorEmailEntry(normalizedEmail, pattern)) {
      return true;
    }

    if (!pattern.includes("*")) {
      return false;
    }

    return wildcardPatternToRegExp(pattern).test(normalizedEmail);
  });
}
