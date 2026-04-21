import { serve } from "@hono/node-server";
import { desc, eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";

import { createBackendApp } from "@firapps/backend-common";
import { checkDatabaseConnection, closeDatabase, runMigrations } from "@firapps/db";

import { auth } from "./auth.js";
import { internalApiEnv } from "./config.js";
import { runtime } from "./db/runtime.js";
import { deployments, tenants } from "./db/schema.js";
import { ensureOperationsSeed } from "./seed.js";

if (internalApiEnv.RUN_MIGRATIONS_ON_BOOT) {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await runMigrations(runtime, migrationsFolder);
}

await ensureOperationsSeed(runtime);

const app = createBackendApp(internalApiEnv.APP_NAME, () => checkDatabaseConnection(runtime));

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

async function requireSession(requestHeaders: Headers) {
  return auth.api.getSession({
    headers: requestHeaders,
  });
}

app.get(`${internalApiEnv.API_PREFIX}/tenants`, async (c) => {
  const session = await requireSession(c.req.raw.headers);

  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const records = await runtime.db.select().from(tenants).orderBy(desc(tenants.createdAt));

  c.get("log").set({
    auth: { userId: session.user.id },
    tenants: { count: records.length },
  });

  return c.json({ tenants: records });
});

app.get(`${internalApiEnv.API_PREFIX}/deployments`, async (c) => {
  const session = await requireSession(c.req.raw.headers);

  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const tenantId = c.req.query("tenantId");

  const query = runtime.db.select().from(deployments).orderBy(desc(deployments.updatedAt));

  const records = tenantId ? await query.where(eq(deployments.tenantId, tenantId)) : await query;

  c.get("log").set({
    auth: { userId: session.user.id },
    deployments: { count: records.length },
  });

  return c.json({ deployments: records });
});

const server = serve(
  {
    fetch: app.fetch,
    port: internalApiEnv.PORT,
  },
  (info) => {
    console.log(`[internal-api] listening on http://localhost:${info.port}`);
  },
);

const shutdown = async () => {
  server.close();
  await closeDatabase(runtime);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
