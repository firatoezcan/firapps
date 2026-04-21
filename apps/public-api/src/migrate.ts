import { fileURLToPath } from "node:url";

import { closeDatabase, createDatabaseRuntime, runMigrations } from "@firapps/db";
import * as schema from "./db/schema.js";

process.env.APP_NAME ??= "public-api";
process.env.DATABASE_SCHEMA ??= "catalog";
process.env.DATABASE_MIGRATIONS_TABLE ??= "__drizzle_public_api_migrations";

const runtime = createDatabaseRuntime(schema);

try {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await runMigrations(runtime, migrationsFolder);
} finally {
  await closeDatabase(runtime);
}
