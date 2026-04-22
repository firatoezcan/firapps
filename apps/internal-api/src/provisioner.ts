import { z } from "zod";

import { internalApiEnv } from "./config.js";

const provisionerWorkspaceSchema = z
  .object({
    createdAt: z.coerce.date().optional(),
    id: z.string().min(1).optional(),
    ideUrl: z.string().url().nullable().optional(),
    imageFlavor: z.string().min(1).optional(),
    nixPackages: z.array(z.string()).optional(),
    provider: z.string().min(1).optional(),
    previewUrl: z.string().url().nullable().optional(),
    repoName: z.string().min(1).optional(),
    repoOwner: z.string().min(1).optional(),
    repoProvider: z.string().min(1).optional(),
    status: z.string().min(1),
    tenantId: z.string().uuid().optional(),
    updatedAt: z.coerce.date().optional(),
    workspaceId: z.string().min(1),
  })
  .passthrough();

const provisionerCreateResponseSchema = z.object({
  workspace: provisionerWorkspaceSchema,
});

const provisionerListResponseSchema = z.object({
  workspaces: z.array(provisionerWorkspaceSchema),
});

const provisionerRunExecutionSchema = z
  .object({
    branchName: z.string().min(1).nullable().optional(),
    branchUsed: z.string().min(1).nullable().optional(),
    commitSha: z.string().min(1).nullable().optional(),
    executionLog: z.string().nullable().optional(),
    failureMessage: z.string().min(1).nullable().optional(),
    pushFailureReason: z.string().min(1).nullable().optional(),
    pushSucceeded: z.boolean().optional(),
    reportMarkdown: z.string().nullable().optional(),
    reportPatch: z.string().nullable().optional(),
    reportPath: z.string().min(1).nullable().optional(),
    repoBranch: z.string().min(1).nullable().optional(),
    repoHeadSha: z.string().min(1).nullable().optional(),
    runId: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    summary: z.string().min(1),
    workspaceId: z.string().min(1),
  })
  .passthrough();

const provisionerExecuteResponseSchema = z.object({
  execution: provisionerRunExecutionSchema,
});

const provisionerOperatorRuntimeServiceSchema = z
  .object({
    detail: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
  })
  .passthrough();

const provisionerOperatorRuntimeSummarySchema = z
  .object({
    failed: z.number().int().nonnegative().optional(),
    provisioning: z.number().int().nonnegative().optional(),
    ready: z.number().int().nonnegative().optional(),
    readyWorkspaceIdeNodes: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    workspaceIdeReadyNodes: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const provisionerOperatorRuntimeSchema = z
  .object({
    generatedAt: z.string().optional(),
    services: z.array(provisionerOperatorRuntimeServiceSchema).optional().default([]),
    workspaceSummary: provisionerOperatorRuntimeSummarySchema.optional(),
  })
  .passthrough();

export type ProvisionerWorkspace = z.infer<typeof provisionerWorkspaceSchema>;
export type ProvisionerRunExecution = z.infer<typeof provisionerRunExecutionSchema>;
export type ProvisionerOperatorRuntime = z.infer<typeof provisionerOperatorRuntimeSchema>;

export class ProvisionerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function requireProvisionerBaseUrl() {
  const baseUrl = internalApiEnv.PLATFORM_PROVISIONER_BASE_URL;

  if (!baseUrl) {
    throw new ProvisionerError("platform_provisioner_not_configured", 503);
  }

  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

async function readProvisionerError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string; message?: string };

    return {
      details: payload,
      message: payload.message ?? payload.error ?? "provisioner_request_failed",
    };
  }

  const payload = await response.text();

  return {
    details: payload,
    message: payload || "provisioner_request_failed",
  };
}

async function provisionerRequest<TOutput>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  timeoutMs = internalApiEnv.PLATFORM_PROVISIONER_TIMEOUT_MS,
) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (internalApiEnv.PLATFORM_PROVISIONER_SHARED_SECRET) {
    headers.set("authorization", `Bearer ${internalApiEnv.PLATFORM_PROVISIONER_SHARED_SECRET}`);
  }

  const response = await fetch(new URL(path, requireProvisionerBaseUrl()), {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const failure = await readProvisionerError(response);

    throw new ProvisionerError(failure.message, response.status, failure.details);
  }

  if (response.status === 204) {
    return schema.parse({});
  }

  return schema.parse(await response.json());
}

export async function createProvisionerWorkspace(input: {
  blueprintId?: string | null;
  blueprintName?: string | null;
  dispatchId?: string | null;
  imageFlavor: string;
  nixPackages: string[];
  organizationId: string;
  provider: string;
  projectId?: string | null;
  projectName?: string | null;
  projectSlug?: string | null;
  pullRequestUrl?: string | null;
  runId?: string | null;
  runTitle?: string | null;
  branchName?: string | null;
  repoName: string;
  repoOwner: string;
  repoProvider: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  workspaceId: string;
}) {
  const payload = await provisionerRequest(
    "workspaces",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    provisionerCreateResponseSchema,
  );

  return payload.workspace;
}

export async function listProvisionerWorkspaces(input: {
  tenantId: string;
  workspaceIds?: string[];
}) {
  const url = new URL("workspaces", requireProvisionerBaseUrl());
  url.searchParams.set("tenantId", input.tenantId);

  for (const workspaceId of input.workspaceIds ?? []) {
    url.searchParams.append("workspaceId", workspaceId);
  }

  const payload = await provisionerRequest(
    `${url.pathname}${url.search}`,
    {
      method: "GET",
    },
    provisionerListResponseSchema,
  );

  return payload.workspaces;
}

export async function deleteProvisionerWorkspace(workspaceId: string) {
  await provisionerRequest(
    `workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: "DELETE",
    },
    z.object({}).passthrough(),
  );
}

export async function executeProvisionerWorkspaceRun(input: {
  blueprintName?: string | null;
  executionPlan?: string | null;
  workspaceId: string;
  runId: string;
  runTitle: string;
  objective: string;
  branchName?: string | null;
  projectName?: string | null;
  repoOwner: string;
  repoName: string;
}) {
  const payload = await provisionerRequest(
    `workspaces/${encodeURIComponent(input.workspaceId)}/execute-run`,
    {
      body: JSON.stringify({
        branchName: input.branchName ?? null,
        blueprintName: input.blueprintName ?? null,
        executionPlan: input.executionPlan ?? null,
        objective: input.objective,
        projectName: input.projectName ?? null,
        repoName: input.repoName,
        repoOwner: input.repoOwner,
        runId: input.runId,
        runTitle: input.runTitle,
      }),
      method: "POST",
    },
    provisionerExecuteResponseSchema,
    internalApiEnv.PLATFORM_PROVISIONER_EXECUTION_TIMEOUT_MS,
  );

  return payload.execution;
}

export async function readProvisionerOperatorRuntime(): Promise<ProvisionerOperatorRuntime> {
  return provisionerRequest(
    "operator/runtime",
    {
      method: "GET",
    },
    provisionerOperatorRuntimeSchema,
  );
}
