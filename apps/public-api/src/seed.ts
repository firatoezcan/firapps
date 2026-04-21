import type { DatabaseRuntime } from "@firapps/db";
import type * as catalogSchema from "./db/schema.js";
import { announcements, products } from "./db/schema.js";

type CatalogRuntime = DatabaseRuntime<typeof catalogSchema>;

export async function ensureCatalogSeed(runtime: CatalogRuntime) {
  const existing = await runtime.db.select({ id: products.id }).from(products).limit(1);

  if (existing.length > 0) {
    return;
  }

  await runtime.db.insert(products).values([
    {
      slug: "starter-kit",
      name: "Starter Kit",
      priceCents: 4900,
      status: "available",
      featured: true,
    },
    {
      slug: "team-plan",
      name: "Team Plan",
      priceCents: 12900,
      status: "beta",
      featured: false,
    },
  ]);

  await runtime.db.insert(announcements).values([
    {
      title: "Customer portal live",
      body: "The TanStack Start customer portal is wired to the public API.",
      tone: "success",
    },
  ]);
}
