import { fileURLToPath } from "node:url";

import { closeDatabase, runMigrations } from "@firapps/db";

import { internalApiEnv } from "./config.js";
import { runtime } from "./db/runtime.js";

void internalApiEnv;

try {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await runMigrations(runtime, migrationsFolder);
} finally {
  await closeDatabase(runtime);
}
