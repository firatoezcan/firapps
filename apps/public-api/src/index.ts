import { serve } from "@hono/node-server";
import { desc } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { createBackendApp, readServiceEnv } from "@firapps/backend-common";
import {
  checkDatabaseConnection,
  closeDatabase,
  createDatabaseRuntime,
  runMigrations,
} from "@firapps/db";

import { announcements, products } from "./db/schema.js";
import { ensureCatalogSeed } from "./seed.js";
import * as schema from "./db/schema.js";

process.env.APP_NAME ??= "public-api";
process.env.PORT ??= "4000";
process.env.DATABASE_SCHEMA ??= "catalog";
process.env.DATABASE_MIGRATIONS_TABLE ??= "__drizzle_public_api_migrations";
process.env.API_PREFIX ??= "/api/public";

const env = readServiceEnv(
  z.object({
    API_PREFIX: z.string().default("/api/public"),
    DATABASE_URL: z.string().min(1),
    DATABASE_SCHEMA: z.string().default("catalog"),
    DATABASE_MIGRATIONS_TABLE: z.string().default("__drizzle_public_api_migrations"),
  }),
);

const runtime = createDatabaseRuntime(schema);

if (env.RUN_MIGRATIONS_ON_BOOT) {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await runMigrations(runtime, migrationsFolder);
}

await ensureCatalogSeed(runtime);

const app = createBackendApp(env.APP_NAME, () => checkDatabaseConnection(runtime));

app.get(`${env.API_PREFIX}/products`, async (c) => {
  const records = await runtime.db.select().from(products).orderBy(desc(products.createdAt));

  c.get("log").set({ catalog: { products: records.length } });

  return c.json({ products: records });
});

app.get(`${env.API_PREFIX}/announcements`, async (c) => {
  const records = await runtime.db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.createdAt));

  return c.json({ announcements: records });
});

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`[public-api] listening on http://localhost:${info.port}`);
  },
);

const shutdown = async () => {
  server.close();
  await closeDatabase(runtime);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
