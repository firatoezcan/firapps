import type { DatabaseRuntime } from "@firapps/db";

import type * as operationsSchema from "./db/schema.js";
import { blueprints, deployments, tenants, type BlueprintStepDefinition } from "./db/schema.js";

type OperationsRuntime = DatabaseRuntime<typeof operationsSchema>;

const defaultBlueprints: Array<{
  description: string;
  name: string;
  slug: string;
  steps: BlueprintStepDefinition[];
}> = [
  {
    slug: "ticket-to-pr",
    name: "Ticket To PR",
    description:
      "Provisions an isolated devbox, clones the repository, runs an implementation pass, and returns review-ready pull request artifacts.",
    steps: [
      { key: "dispatch_received", kind: "deterministic", label: "Dispatch received" },
      { key: "provision_devbox", kind: "deterministic", label: "Provision devbox" },
      { key: "clone_repository", kind: "deterministic", label: "Clone repository" },
      { key: "implement_changes", kind: "agentic", label: "Implement changes" },
      { key: "validate_output", kind: "deterministic", label: "Validate output" },
      { key: "open_pull_request", kind: "deterministic", label: "Open pull request" },
    ],
  },
  {
    slug: "backlog-bugfix",
    name: "Backlog Bugfix",
    description:
      "Optimized for bounded bugfix work with one agentic implementation step and deterministic review gates.",
    steps: [
      { key: "dispatch_received", kind: "deterministic", label: "Dispatch received" },
      { key: "provision_devbox", kind: "deterministic", label: "Provision devbox" },
      { key: "inspect_context", kind: "agentic", label: "Inspect repo and implement fix" },
      { key: "run_quality_gates", kind: "deterministic", label: "Run quality gates" },
      { key: "prepare_review", kind: "deterministic", label: "Prepare review artifacts" },
    ],
  },
];

export async function ensureOperationsSeed(runtime: OperationsRuntime) {
  const existingBlueprint = await runtime.db
    .select({ id: blueprints.id })
    .from(blueprints)
    .limit(1);

  if (existingBlueprint.length === 0) {
    await runtime.db.insert(blueprints).values(
      defaultBlueprints.map((blueprint) => ({
        description: blueprint.description,
        name: blueprint.name,
        scope: "system",
        slug: blueprint.slug,
        steps: blueprint.steps,
        triggerSource: "manual",
      })),
    );
  }

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
