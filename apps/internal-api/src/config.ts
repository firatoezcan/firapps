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
process.env.AUTH_BASE_URL ??= "http://127.0.0.1:4001";
process.env.CUSTOMER_WEB_URL ??= "http://127.0.0.1:3000";
process.env.ADMIN_WEB_URL ??= "http://127.0.0.1:3001";
process.env.ALLOWED_ORIGINS ??= defaultAllowedOrigins;
process.env.BETTER_AUTH_SECRET ??=
  "devboxes-local-better-auth-secret-2026-04-21-keep-this-overridden";

export const internalApiEnv = readServiceEnv(
  z.object({
    API_PREFIX: z.string().default("/api/internal"),
    DATABASE_URL: z.string().min(1).default(defaultDatabaseUrl),
    DATABASE_SCHEMA: z.string().default("operations"),
    DATABASE_MIGRATIONS_TABLE: z.string().default("__drizzle_internal_api_migrations"),
    AUTH_BASE_URL: z.string().url().default("http://127.0.0.1:4001"),
    CUSTOMER_WEB_URL: z.string().url().default("http://127.0.0.1:3000"),
    ADMIN_WEB_URL: z.string().url().default("http://127.0.0.1:3001"),
    ALLOWED_ORIGINS: z.string().default(defaultAllowedOrigins),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
  }),
);

export function listAllowedOrigins(csv = internalApiEnv.ALLOWED_ORIGINS) {
  return csv
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
