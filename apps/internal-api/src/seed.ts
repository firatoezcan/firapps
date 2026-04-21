import type { DatabaseRuntime } from "@firapps/db";

import type * as operationsSchema from "./db/schema.js";
import { deployments, tenants } from "./db/schema.js";

type OperationsRuntime = DatabaseRuntime<typeof operationsSchema>;

export async function ensureOperationsSeed(runtime: OperationsRuntime) {
  const existing = await runtime.db.select({ id: tenants.id }).from(tenants).limit(1);

  if (existing.length > 0) {
    return;
  }

  const [firstTenant] = await runtime.db
    .insert(tenants)
    .values([
      {
        slug: "northwind",
        name: "Northwind",
        plan: "enterprise",
        status: "healthy",
      },
      {
        slug: "acme",
        name: "Acme",
        plan: "growth",
        status: "migrating",
      },
    ])
    .returning({ id: tenants.id });

  if (!firstTenant) {
    return;
  }

  await runtime.db.insert(deployments).values([
    {
      tenantId: firstTenant.id,
      environment: "sandbox",
      version: "sha-bootstrap",
      status: "ready",
    },
    {
      tenantId: firstTenant.id,
      environment: "production",
      version: "sha-next",
      status: "pending",
    },
  ]);
}
