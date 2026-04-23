import { serve } from "@hono/node-server";
import { hashPassword } from "better-auth/crypto";
import type { Context } from "hono";
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { createBackendApp } from "@firapps/backend-common";
import { checkDatabaseConnection, closeDatabase, runMigrations } from "@firapps/db";

import { auth } from "./auth.js";
import { internalApiEnv, listOperatorEmails, operatorEmailAllowed } from "./config.js";
import { electricSyncConfigured, proxyElectricShape } from "./electric.js";
import {
  buildRunBranchName,
  createRunPullRequest,
  GitHubIntegrationError,
  readGitHubPullRequestMetadata,
  validateGitHubRepositoryRegistration,
} from "./github.js";
import { requireOrganizationAccess } from "./organization-access.js";
import {
  ProvisionerError,
  createProvisionerWorkspace,
  deleteProvisionerWorkspace,
  executeProvisionerWorkspaceRun,
  listProvisionerWorkspaces,
  readProvisionerOperatorRuntime,
  type ProvisionerOperatorRuntime,
  type ProvisionerRunExecution,
  type ProvisionerWorkspace,
} from "./provisioner.js";
import { runtime } from "./db/runtime.js";
import {
  activityEvents,
  accounts,
  blueprints,
  dispatches,
  deployments,
  organizationInvitations,
  organizationMemberships,
  organizations,
  organizationTenants,
  organizationWorkspaces,
  runnerJobArtifacts,
  runnerJobEvents,
  runnerJobs,
  runnerRegistrations,
  runnerSessions,
  runArtifacts,
  runEvents,
  runs,
  runSteps,
  tenants,
  users,
  type ActivityEventMetadata,
  type BlueprintStepDefinition,
  type DispatchMetadata,
  type JsonValue,
  type RunnerOperation,
  type RunEventMetadata,
} from "./db/schema.js";
import {
  buildRunnerSecretPreview,
  claimRunnerJobSchema,
  completeRunnerJobSchema,
  createRunnerApiKey,
  createRunnerJobSchema,
  createRunnerRegistrationSchema,
  createRunnerSessionSchema,
  createRunnerSessionToken,
  defaultRunnerLeaseSeconds,
  hashRunnerSecret,
  nextRunnerLeaseExpiry,
  nextRunnerSessionExpiry,
  runnerHeartbeatSchema,
  runnerIdParamsSchema,
  runnerJobEventSchema,
  runnerJobIdParamsSchema,
  runnerOperations,
  runnerProtocolVersion,
  toRunnerMetadata,
  updateRunnerLeaseSchema,
  uploadRunnerArtifactsSchema,
} from "./runner-control-plane.js";
import { ensureOperationsSeed } from "./seed.js";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const repoProviderSchema = z.enum(["github", "gitlab", "bitbucket"]);
const projectWorkflowModeSchema = z.enum(["blueprint", "manual"]);
const runSourceSchema = z.enum(["manual", "slack", "email", "webhook"]);
const blueprintStepSchema = z.object({
  key: z.string().trim().min(1).max(80),
  kind: z.enum(["agentic", "deterministic"]),
  label: z.string().trim().min(1).max(160),
});

const projectInputSchema = z
  .object({
    billingEmail: z.string().trim().email().max(320).nullable().optional(),
    billingPlan: z.string().trim().min(1).max(64).nullable().optional().default("growth"),
    billingStatus: z.string().trim().min(1).max(64).nullable().optional().default("active"),
    billingReference: z.string().trim().min(1).max(128).nullable().optional(),
    defaultBlueprintId: z.string().uuid().nullable().optional(),
    defaultBranch: z.string().trim().min(1).max(120).optional().default("main"),
    description: z.string().trim().max(1000).nullable().optional(),
    name: z.string().trim().min(1).max(120),
    repoName: z.string().trim().min(1).max(200).nullable().optional(),
    repoOwner: z.string().trim().min(1).max(200).nullable().optional(),
    repoProvider: repoProviderSchema.nullable().optional(),
    seatLimit: z.number().int().positive().max(100000).nullable().optional(),
    slug: slugSchema,
    workflowMode: projectWorkflowModeSchema.optional().default("blueprint"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasRepoName = value.repoName != null;
    const hasRepoOwner = value.repoOwner != null;
    const hasRepoProvider = value.repoProvider != null;

    if (hasRepoName || hasRepoOwner || hasRepoProvider) {
      if (!hasRepoName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "repoName is required when repository settings are provided",
          path: ["repoName"],
        });
      }

      if (!hasRepoOwner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "repoOwner is required when repository settings are provided",
          path: ["repoOwner"],
        });
      }

      if (!hasRepoProvider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "repoProvider is required when repository settings are provided",
          path: ["repoProvider"],
        });
      }
    }
  });

const projectPatchSchema = z
  .object({
    billingEmail: z.string().trim().email().max(320).nullable().optional(),
    billingPlan: z.string().trim().min(1).max(64).nullable().optional(),
    billingStatus: z.string().trim().min(1).max(64).nullable().optional(),
    billingReference: z.string().trim().min(1).max(128).nullable().optional(),
    defaultBlueprintId: z.string().uuid().nullable().optional(),
    defaultBranch: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    repoName: z.string().trim().min(1).max(200).nullable().optional(),
    repoOwner: z.string().trim().min(1).max(200).nullable().optional(),
    repoProvider: repoProviderSchema.nullable().optional(),
    seatLimit: z.number().int().positive().max(100000).nullable().optional(),
    slug: slugSchema.optional(),
    workflowMode: projectWorkflowModeSchema.optional(),
  })
  .strict();

const workspaceQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

const createWorkspaceSchema = z
  .object({
    imageFlavor: z.string().trim().min(1).max(120),
    nixPackages: z.array(z.string().trim().min(1).max(120)).optional().default([]),
    provider: z.string().trim().min(1).max(120).optional().default("daytona"),
    repoName: z.string().trim().min(1).max(200),
    repoOwner: z.string().trim().min(1).max(200),
    repoProvider: repoProviderSchema.optional().default("github"),
    tenantId: z.string().uuid(),
  })
  .strict();

const deleteWorkspaceParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

const createBlueprintSchema = z
  .object({
    description: z.string().trim().min(1).max(1000),
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    steps: z.array(blueprintStepSchema).min(1).max(20),
    triggerSource: runSourceSchema.optional().default("manual"),
  })
  .strict();

const updateBlueprintSchema = z
  .object({
    description: z.string().trim().min(1).max(1000).optional(),
    isActive: z.boolean().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    slug: slugSchema.optional(),
    steps: z.array(blueprintStepSchema).min(1).max(20).optional(),
    triggerSource: runSourceSchema.optional(),
  })
  .strict();

const requestedByScopeQuerySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["current", "me", "self"]).transform(() => "self" as const),
);

const listRunsQuerySchema = z
  .object({
    requestedBy: requestedByScopeQuerySchema.optional(),
    source: runSourceSchema.optional(),
    tenantId: z.string().uuid().optional(),
  })
  .strict();

const listPullRequestsQuerySchema = z
  .object({
    requestedBy: requestedByScopeQuerySchema.optional(),
  })
  .strict();

const listDispatchesQuerySchema = z
  .object({
    requestedBy: requestedByScopeQuerySchema.optional(),
    source: runSourceSchema.optional(),
    tenantId: z.string().uuid().optional(),
  })
  .strict();

const createRunSchema = z
  .object({
    blueprintId: z.string().uuid().nullable().optional(),
    objective: z.string().trim().min(1).max(4000),
    source: runSourceSchema.optional().default("manual"),
    tenantId: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
  })
  .strict();

const runIdParamsSchema = z.object({
  runId: z.string().uuid(),
});

const retryRunParamsSchema = runIdParamsSchema;
const projectIdParamsSchema = z.object({
  projectId: z.string().uuid(),
});
const blueprintIdParamsSchema = z.object({
  blueprintId: z.string().uuid(),
});
const slackDispatchInputSchema = z
  .object({
    blueprintSlug: slugSchema.optional(),
    objective: z.string().trim().min(1).max(4000),
    organizationSlug: slugSchema.optional(),
    projectSlug: slugSchema,
    requestedByEmail: z.string().trim().email().max(320).optional(),
    requestedByName: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().min(1).max(160),
  })
  .strict();

type OrganizationWorkspaceRecord = typeof organizationWorkspaces.$inferSelect;
type BlueprintRecord = typeof blueprints.$inferSelect;
type DispatchRecord = typeof dispatches.$inferSelect;
type ProjectRecord = typeof organizationTenants.$inferSelect;
type RunnerJobRecord = typeof runnerJobs.$inferSelect;
type RunnerRegistrationRecord = typeof runnerRegistrations.$inferSelect;
type RunnerSessionRecord = typeof runnerSessions.$inferSelect;
type RunRecord = typeof runs.$inferSelect;
type RunStepRecord = typeof runSteps.$inferSelect;
type RunnerSessionAuth =
  | {
      response?: never;
      runner: RunnerRegistrationRecord;
      session: RunnerSessionRecord;
    }
  | {
      response: Response;
      runner?: never;
      session?: never;
    };

type RunRequestorRecord = Pick<typeof users.$inferSelect, "email" | "id" | "name">;
type BuildRunResponseOptions = {
  reconcile?: boolean;
};

function buildElectricUuidInFilter(columnName: string, ids: string[]) {
  if (ids.length === 0) {
    return {
      params: {},
      where: `${columnName} is null`,
    };
  }

  const placeholders = ids.map((_, index) => `$${index + 1}`);

  return {
    params: Object.fromEntries(ids.map((id, index) => [String(index + 1), id])),
    where: `${columnName} in (${placeholders.join(", ")})`,
  };
}

const activeRunStatuses = ["provisioning", "workspace_ready", "in_progress"] as const;
let runReconciliationInFlight: Promise<void> | null = null;
let runReconciliationRequested = false;
const runExecutionInFlight = new Set<string>();

const debugLoginOrganization = {
  name: "Firapps Debug Workspace",
  slug: "firapps-debug",
};

const debugLoginPersonas = [
  {
    description: "Owner and operator-allowlisted account for founder/admin flows.",
    email: "founder@operator.local",
    key: "founder",
    label: "Founder operator",
    name: "Debug Founder",
    password: "FirappsDebug!2026",
    role: "owner",
  },
  {
    description: "Admin member for organization management without owner identity.",
    email: "admin@operator.local",
    key: "admin",
    label: "Organization admin",
    name: "Debug Admin",
    password: "FirappsDebug!2026",
    role: "admin",
  },
  {
    description: "Regular member account for non-admin customer and admin visibility checks.",
    email: "member@member.local",
    key: "member",
    label: "Regular member",
    name: "Debug Member",
    password: "FirappsDebug!2026",
    role: "member",
  },
] as const;

type DebugLoginPersona = (typeof debugLoginPersonas)[number];

if (internalApiEnv.RUN_MIGRATIONS_ON_BOOT) {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await runMigrations(runtime, migrationsFolder);
}

await ensureOperationsSeed(runtime);

const app = createBackendApp(internalApiEnv.APP_NAME, () => checkDatabaseConnection(runtime));

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get(`${internalApiEnv.API_PREFIX}/debug-login/personas`, (c) => {
  if (!internalApiEnv.FIRAPPS_DEBUG_LOGIN_ENABLED) {
    return debugLoginDisabledResponse(c);
  }

  return c.json({
    enabled: true,
    personas: debugLoginPersonas.map(debugPersonaPublicFields),
  });
});

app.post(`${internalApiEnv.API_PREFIX}/debug-login/personas/:personaKey`, async (c) => {
  if (!internalApiEnv.FIRAPPS_DEBUG_LOGIN_ENABLED) {
    return debugLoginDisabledResponse(c);
  }

  const personaKey = c.req.param("personaKey");
  const persona = debugLoginPersonas.find((entry) => entry.key === personaKey);

  if (!persona) {
    return c.json({ error: "debug_persona_not_found" }, 404);
  }

  const provisioned = await ensureDebugLoginPersona(persona);

  c.get("log").set({
    debugLogin: {
      organizationId: provisioned.organization.id,
      persona: persona.key,
      userId: provisioned.user.id,
    },
  });

  return c.json({
    organization: {
      id: provisioned.organization.id,
      name: provisioned.organization.name,
      slug: provisioned.organization.slug,
    },
    persona: {
      ...provisioned.persona,
      password: persona.password,
    },
  });
});

async function requireSession(requestHeaders: Headers) {
  return auth.api.getSession({
    headers: requestHeaders,
  });
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function toLoggableError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function debugPersonaPublicFields(persona: DebugLoginPersona) {
  return {
    description: persona.description,
    email: persona.email,
    key: persona.key,
    label: persona.label,
    role: persona.role,
  };
}

function debugLoginDisabledResponse(c: Context) {
  return c.json({ error: "not_found" }, 404);
}

async function ensureDebugLoginOrganization() {
  const [existing] = await runtime.db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, debugLoginOrganization.slug))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await runtime.db
    .insert(organizations)
    .values({
      name: debugLoginOrganization.name,
      slug: debugLoginOrganization.slug,
    })
    .returning();

  return created;
}

async function ensureDebugLoginPersona(persona: DebugLoginPersona) {
  const normalizedEmail = persona.email.toLowerCase();
  const now = new Date();
  const [existingUser] = await runtime.db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  const [user] = existingUser
    ? await runtime.db
        .update(users)
        .set({
          emailVerified: true,
          name: persona.name,
          updatedAt: now,
        })
        .where(eq(users.id, existingUser.id))
        .returning()
    : await runtime.db
        .insert(users)
        .values({
          email: normalizedEmail,
          emailVerified: true,
          name: persona.name,
        })
        .returning();

  const passwordHash = await hashPassword(persona.password);
  await runtime.db
    .insert(accounts)
    .values({
      accountId: user.id,
      password: passwordHash,
      providerId: "credential",
      userId: user.id,
    })
    .onConflictDoUpdate({
      target: [accounts.providerId, accounts.accountId],
      set: {
        password: passwordHash,
        updatedAt: now,
      },
    });

  const organization = await ensureDebugLoginOrganization();

  await runtime.db
    .insert(organizationMemberships)
    .values({
      organizationId: organization.id,
      role: persona.role,
      userId: user.id,
    })
    .onConflictDoUpdate({
      target: [organizationMemberships.organizationId, organizationMemberships.userId],
      set: {
        role: persona.role,
      },
    });

  return {
    organization,
    persona: debugPersonaPublicFields(persona),
    user,
  };
}

function buildProvisionerErrorResponse(c: Context, error: unknown) {
  if (!(error instanceof ProvisionerError)) {
    throw error;
  }

  c.get("log").error(toLoggableError(error), {
    provisioner: {
      details: error.details,
      status: error.status,
    },
  });

  const status =
    error.status === 401
      ? 401
      : error.status === 403
        ? 403
        : error.status === 404
          ? 404
          : error.status === 409
            ? 409
            : error.status === 503
              ? 503
              : 502;

  return c.json(
    {
      error: "provisioner_error",
      message: error.message,
    },
    { status },
  );
}

function buildGitHubErrorResponse(c: Context, error: unknown) {
  if (!(error instanceof GitHubIntegrationError)) {
    throw error;
  }

  c.get("log").error(toLoggableError(error), {
    github: {
      details: error.details,
      status: error.status,
    },
  });

  const status =
    error.status === 401
      ? 401
      : error.status === 403
        ? 403
        : error.status === 404
          ? 404
          : error.status === 409
            ? 409
            : error.status === 422
              ? 422
              : error.status === 503
                ? 503
                : 502;

  return c.json(
    {
      error: "github_integration_error",
      message: error.message,
    },
    { status },
  );
}

function toRunnerRegistrationResponse(record: RunnerRegistrationRecord) {
  return {
    allowedOperations: record.allowedOperations,
    apiKeyExpiresAt: record.apiKeyExpiresAt,
    apiKeyPreview: record.apiKeyPreview,
    capabilityScopes: record.capabilityScopes,
    createdAt: record.createdAt,
    createdByUserId: record.createdByUserId,
    displayName: record.displayName,
    id: record.id,
    imageDigest: record.imageDigest,
    lastHeartbeatAt: record.lastHeartbeatAt,
    maxConcurrency: record.maxConcurrency,
    organizationId: record.organizationId,
    protocolVersion: record.protocolVersion,
    repositoryScopes: record.repositoryScopes,
    revokedAt: record.revokedAt,
    runnerVersion: record.runnerVersion,
    status: record.status,
    tenantId: record.tenantId,
    updatedAt: record.updatedAt,
  };
}

function toRunnerJobResponse(record: RunnerJobRecord) {
  return {
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    failureMessage: record.failureMessage,
    id: record.id,
    idempotencyKey: record.idempotencyKey,
    leaseExpiresAt: record.leaseExpiresAt,
    operation: record.operation,
    organizationId: record.organizationId,
    params: record.params,
    result: record.result,
    runId: record.runId,
    runnerId: record.runnerId,
    status: record.status,
    tenantId: record.tenantId,
    updatedAt: record.updatedAt,
  };
}

function readBearerToken(c: Context) {
  const authorization = c.req.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

async function requireRunnerSession(
  c: Context,
  expectedRunnerId?: string,
): Promise<RunnerSessionAuth> {
  const token = readBearerToken(c);

  if (!token) {
    return {
      response: c.json({ error: "runner_session_required" }, 401),
    };
  }

  const now = new Date();
  const filters = [
    eq(runnerSessions.tokenHash, hashRunnerSecret(token)),
    isNull(runnerSessions.revokedAt),
    gt(runnerSessions.expiresAt, now),
    or(eq(runnerRegistrations.status, "active"), eq(runnerRegistrations.status, "online")),
    isNull(runnerRegistrations.revokedAt),
    or(isNull(runnerRegistrations.apiKeyExpiresAt), gt(runnerRegistrations.apiKeyExpiresAt, now)),
  ];

  if (expectedRunnerId) {
    filters.push(eq(runnerRegistrations.id, expectedRunnerId));
  }

  const [record] = await runtime.db
    .select({
      runner: runnerRegistrations,
      session: runnerSessions,
    })
    .from(runnerSessions)
    .innerJoin(runnerRegistrations, eq(runnerSessions.runnerId, runnerRegistrations.id))
    .where(and(...filters))
    .limit(1);

  if (!record) {
    return {
      response: c.json({ error: "runner_session_invalid" }, 401),
    };
  }

  c.get("log").set({
    runnerAuth: {
      runnerId: record.runner.id,
      sessionId: record.session.id,
    },
  });

  return record;
}

async function getOrganizationRunnerRecord(organizationId: string, runnerId: string) {
  const [record] = await runtime.db
    .select()
    .from(runnerRegistrations)
    .where(
      and(
        eq(runnerRegistrations.organizationId, organizationId),
        eq(runnerRegistrations.id, runnerId),
      ),
    )
    .limit(1);

  return record ?? null;
}

function runnerCanServeTenant(runner: RunnerRegistrationRecord, tenantId: string) {
  return runner.tenantId == null || runner.tenantId === tenantId;
}

function runnerCanServeOperation(runner: RunnerRegistrationRecord, operation: RunnerOperation) {
  return runner.allowedOperations.includes(operation);
}

async function assertRunnerJobScope(input: {
  operation: RunnerOperation;
  organizationId: string;
  runnerId?: string | null;
  tenantId: string;
}) {
  const project = await getOrganizationTenantRecord(input.organizationId, input.tenantId);

  if (!project) {
    return {
      error: "project_not_found",
      status: 404,
    } as const;
  }

  if (!input.runnerId) {
    return {
      project,
    } as const;
  }

  const runner = await getOrganizationRunnerRecord(input.organizationId, input.runnerId);

  if (!runner || !["active", "online"].includes(runner.status) || runner.revokedAt != null) {
    return {
      error: "runner_not_found",
      status: 404,
    } as const;
  }

  if (!runnerCanServeTenant(runner, input.tenantId)) {
    return {
      error: "runner_tenant_scope_mismatch",
      status: 422,
    } as const;
  }

  if (!runnerCanServeOperation(runner, input.operation)) {
    return {
      error: "runner_operation_not_allowed",
      status: 422,
    } as const;
  }

  return {
    project,
    runner,
  } as const;
}

async function getRunnerOwnedJob(input: { jobId: string; runnerId: string }) {
  const [record] = await runtime.db
    .select()
    .from(runnerJobs)
    .where(and(eq(runnerJobs.id, input.jobId), eq(runnerJobs.runnerId, input.runnerId)))
    .limit(1);

  return record ?? null;
}

async function getOrganizationTenantRecord(organizationId: string, tenantId: string) {
  const [record] = await runtime.db
    .select()
    .from(organizationTenants)
    .where(
      and(
        eq(organizationTenants.organizationId, organizationId),
        eq(organizationTenants.id, tenantId),
      ),
    )
    .limit(1);

  return record ?? null;
}

async function getAccessibleBlueprintRecord(organizationId: string, blueprintId: string) {
  const [record] = await runtime.db
    .select()
    .from(blueprints)
    .where(
      and(
        eq(blueprints.id, blueprintId),
        eq(blueprints.isActive, true),
        or(eq(blueprints.organizationId, organizationId), isNull(blueprints.organizationId)),
      ),
    )
    .limit(1);

  return record ?? null;
}

async function getOwnedBlueprintRecord(organizationId: string, blueprintId: string) {
  const [record] = await runtime.db
    .select()
    .from(blueprints)
    .where(and(eq(blueprints.id, blueprintId), eq(blueprints.organizationId, organizationId)))
    .limit(1);

  return record ?? null;
}

async function getDefaultBlueprintRecord(organizationId: string) {
  const [record] = await runtime.db
    .select()
    .from(blueprints)
    .where(
      and(
        eq(blueprints.isActive, true),
        or(eq(blueprints.organizationId, organizationId), isNull(blueprints.organizationId)),
      ),
    )
    .orderBy(desc(blueprints.organizationId), blueprints.slug)
    .limit(1);

  return record ?? null;
}

async function ensureAccessibleBlueprintId(
  organizationId: string,
  blueprintId: string | null | undefined,
) {
  if (!blueprintId) {
    return null;
  }

  return getAccessibleBlueprintRecord(organizationId, blueprintId);
}

async function getOrganizationMemberUserByEmail(organizationId: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  const [record] = await runtime.db
    .select({
      user: users,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(organizationMemberships.userId, users.id))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        sql`lower(${users.email}) = ${normalizedEmail}`,
      ),
    )
    .limit(1);

  return record?.user ?? null;
}

async function recordActivityEvent(input: {
  actorUserId?: string | null;
  blueprintId?: string | null;
  description: string;
  kind: string;
  metadata?: ActivityEventMetadata;
  occurredAt?: Date;
  organizationId: string;
  runId?: string | null;
  status?: string;
  tenantId?: string | null;
  title: string;
  workspaceRecordId?: string | null;
}) {
  await runtime.db.insert(activityEvents).values({
    actorUserId: input.actorUserId ?? null,
    blueprintId: input.blueprintId ?? null,
    description: input.description,
    kind: input.kind,
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt ?? new Date(),
    organizationId: input.organizationId,
    runId: input.runId ?? null,
    status: input.status ?? "completed",
    tenantId: input.tenantId ?? null,
    title: input.title,
    workspaceRecordId: input.workspaceRecordId ?? null,
  });
}

async function recordRunEvent(input: {
  eventKind: string;
  level?: string;
  message: string;
  metadata?: RunEventMetadata;
  runId: string;
  stepKey?: string | null;
}) {
  await runtime.db.insert(runEvents).values({
    eventKind: input.eventKind,
    level: input.level ?? "info",
    message: input.message,
    metadata: input.metadata ?? {},
    runId: input.runId,
    stepKey: input.stepKey ?? null,
  });
}

async function recordRunLifecycleEvent(input: {
  actorUserId?: string | null;
  blueprintId?: string | null;
  description: string;
  eventKind: string;
  level?: string;
  message: string;
  metadata?: RunEventMetadata;
  organizationId: string;
  runId: string;
  status?: string;
  stepKey?: string | null;
  tenantId: string;
  title: string;
  workspaceRecordId?: string | null;
}) {
  await Promise.all([
    recordRunEvent({
      eventKind: input.eventKind,
      level: input.level,
      message: input.message,
      metadata: input.metadata,
      runId: input.runId,
      stepKey: input.stepKey,
    }),
    recordActivityEvent({
      actorUserId: input.actorUserId ?? null,
      blueprintId: input.blueprintId ?? null,
      description: input.description,
      kind: input.eventKind,
      metadata: input.metadata,
      organizationId: input.organizationId,
      runId: input.runId,
      status: input.status ?? "completed",
      tenantId: input.tenantId,
      title: input.title,
      workspaceRecordId: input.workspaceRecordId ?? null,
    }),
  ]);
}

function pickDefined<TValue extends Record<string, unknown>>(values: TValue) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<TValue>;
}

async function validateProjectRepositorySettings(input: {
  defaultBranch: string;
  repoName: string | null | undefined;
  repoOwner: string | null | undefined;
  repoProvider: string | null | undefined;
}) {
  if (!input.repoProvider || !input.repoOwner || !input.repoName) {
    return null;
  }

  return validateGitHubRepositoryRegistration({
    defaultBranch: input.defaultBranch,
    repoName: input.repoName,
    repoOwner: input.repoOwner,
    repoProvider: input.repoProvider,
  });
}

async function createDispatchRecord(input: {
  blueprint: BlueprintRecord | null;
  objective: string;
  organizationId: string;
  project: ProjectRecord;
  requestedByEmail?: string | null;
  requestedByName?: string | null;
  requestedByUserId?: string | null;
  requestPayload?: DispatchMetadata;
  source: z.infer<typeof runSourceSchema>;
  sourceMetadata?: DispatchMetadata;
  title: string;
}) {
  const [dispatchRecord] = await runtime.db
    .insert(dispatches)
    .values({
      blueprintId: input.blueprint?.id ?? null,
      objective: input.objective,
      organizationId: input.organizationId,
      requestPayload: input.requestPayload ?? {},
      requestedByEmail: input.requestedByEmail ?? null,
      requestedByName: input.requestedByName ?? null,
      requestedByUserId: input.requestedByUserId ?? null,
      source: input.source,
      sourceMetadata: input.sourceMetadata ?? {},
      tenantId: input.project.id,
      title: input.title,
      updatedAt: new Date(),
    })
    .returning();

  await recordActivityEvent({
    actorUserId: input.requestedByUserId ?? null,
    blueprintId: input.blueprint?.id ?? null,
    description: `${input.source} dispatch received for ${input.project.name}.`,
    kind: "dispatch_received",
    metadata: {
      projectSlug: input.project.slug,
      source: input.source,
    },
    organizationId: input.organizationId,
    status: "completed",
    tenantId: input.project.id,
    title: input.title,
  });

  return dispatchRecord;
}

async function buildDispatchResponseItems(dispatchRecords: DispatchRecord[]) {
  if (dispatchRecords.length === 0) {
    return [];
  }

  const tenantIds = [...new Set(dispatchRecords.map((dispatchRecord) => dispatchRecord.tenantId))];
  const blueprintIds = [
    ...new Set(
      dispatchRecords
        .map((dispatchRecord) => dispatchRecord.blueprintId)
        .filter((value): value is string => value != null),
    ),
  ];
  const requestedByUserIds = [
    ...new Set(
      dispatchRecords
        .map((dispatchRecord) => dispatchRecord.requestedByUserId)
        .filter((value): value is string => value != null),
    ),
  ];
  const runIds = [
    ...new Set(
      dispatchRecords
        .map((dispatchRecord) => dispatchRecord.runId)
        .filter((value): value is string => value != null),
    ),
  ];

  const [projects, blueprintRecords, requestors, runRecords] = await Promise.all([
    runtime.db.select().from(organizationTenants).where(inArray(organizationTenants.id, tenantIds)),
    blueprintIds.length > 0
      ? runtime.db.select().from(blueprints).where(inArray(blueprints.id, blueprintIds))
      : Promise.resolve([]),
    requestedByUserIds.length > 0
      ? runtime.db.select().from(users).where(inArray(users.id, requestedByUserIds))
      : Promise.resolve([]),
    runIds.length > 0
      ? runtime.db.select().from(runs).where(inArray(runs.id, runIds))
      : Promise.resolve([]),
  ]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const blueprintById = new Map(blueprintRecords.map((blueprint) => [blueprint.id, blueprint]));
  const requestorById = new Map(requestors.map((requestor) => [requestor.id, requestor]));
  const runById = new Map(runRecords.map((runRecord) => [runRecord.id, runRecord]));

  return dispatchRecords.map((dispatchRecord) => {
    const project = projectById.get(dispatchRecord.tenantId);
    const blueprint =
      dispatchRecord.blueprintId != null ? blueprintById.get(dispatchRecord.blueprintId) : null;
    const requestor =
      dispatchRecord.requestedByUserId != null
        ? requestorById.get(dispatchRecord.requestedByUserId)
        : null;
    const runRecord =
      dispatchRecord.runId != null ? (runById.get(dispatchRecord.runId) ?? null) : null;

    return {
      ...dispatchRecord,
      blueprintName: blueprint?.name ?? null,
      projectName: project?.name ?? null,
      projectSlug: project?.slug ?? null,
      requestedBy: requestor
        ? {
            email: requestor.email,
            id: requestor.id,
            name: requestor.name,
          }
        : null,
      run: runRecord
        ? {
            createdAt: runRecord.createdAt,
            id: runRecord.id,
            source: runRecord.source,
            status: runRecord.status,
            title: runRecord.title,
            updatedAt: runRecord.updatedAt,
          }
        : null,
    };
  });
}

function buildWorkspaceId(tenantSlug: string) {
  const normalizedTenantSlug =
    tenantSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);

  return `${normalizedTenantSlug}-${suffix}`.slice(0, 63);
}

function defaultBlueprintSteps(): BlueprintStepDefinition[] {
  return [
    {
      key: "dispatch_received",
      kind: "deterministic",
      label: "Dispatch received",
    },
    {
      key: "provision_devbox",
      kind: "deterministic",
      label: "Provision devbox",
    },
    {
      key: "clone_repository",
      kind: "deterministic",
      label: "Clone repository",
    },
    {
      key: "implement_changes",
      kind: "agentic",
      label: "Implement changes",
    },
    {
      key: "validate_output",
      kind: "deterministic",
      label: "Validate output",
    },
    {
      key: "open_pull_request",
      kind: "deterministic",
      label: "Open pull request",
    },
  ];
}

function resolveBlueprintSteps(blueprint: BlueprintRecord | null | undefined) {
  return blueprint?.steps?.length ? blueprint.steps : defaultBlueprintSteps();
}

function buildBlueprintExecutionPlan(blueprint: BlueprintRecord | null | undefined) {
  if (!blueprint) {
    return null;
  }

  const stepLines = resolveBlueprintSteps(blueprint).map(
    (step, index) => `${index + 1}. ${step.label} [${step.kind}] key=${step.key}`,
  );

  return [
    `Blueprint: ${blueprint.name}`,
    `Trigger source: ${blueprint.triggerSource}`,
    "",
    ...stepLines,
  ].join("\n");
}

function applyProvisionerWorkspaceState(
  record: OrganizationWorkspaceRecord,
  runtimeState?: ProvisionerWorkspace,
) {
  return {
    ...record,
    ideUrl: runtimeState?.ideUrl ?? record.ideUrl ?? null,
    provider: runtimeState?.provider ?? record.provider,
    previewUrl: runtimeState?.previewUrl ?? record.previewUrl ?? null,
    status: runtimeState?.status ?? record.status,
    updatedAt: runtimeState?.updatedAt ?? record.updatedAt,
  };
}

function mergeWorkspaceRecord(
  record: OrganizationWorkspaceRecord,
  runtimeState?: ProvisionerWorkspace,
) {
  return {
    ...applyProvisionerWorkspaceState(record, runtimeState),
    id: record.workspaceId,
  };
}

async function syncWorkspaceCache(
  records: OrganizationWorkspaceRecord[],
  runtimeStates: ProvisionerWorkspace[],
) {
  const localByWorkspaceId = new Map(records.map((record) => [record.workspaceId, record]));

  await Promise.all(
    runtimeStates.map(async (runtimeState) => {
      const localRecord = localByWorkspaceId.get(runtimeState.workspaceId);

      if (!localRecord) {
        return;
      }

      const nextIdeUrl = runtimeState.ideUrl ?? null;
      const nextPreviewUrl = runtimeState.previewUrl ?? null;
      const nextUpdatedAt = runtimeState.updatedAt ?? new Date();
      const hasChanged =
        localRecord.status !== runtimeState.status ||
        localRecord.ideUrl !== nextIdeUrl ||
        localRecord.previewUrl !== nextPreviewUrl ||
        localRecord.updatedAt.getTime() !== nextUpdatedAt.getTime();

      if (!hasChanged) {
        return;
      }

      await runtime.db
        .update(organizationWorkspaces)
        .set({
          ideUrl: nextIdeUrl,
          previewUrl: nextPreviewUrl,
          status: runtimeState.status,
          updatedAt: nextUpdatedAt,
        })
        .where(eq(organizationWorkspaces.id, localRecord.id));
    }),
  );
}

function toProjectResponse(
  record: Pick<
    ProjectRecord,
    | "billingEmail"
    | "billingPlan"
    | "billingReference"
    | "billingStatus"
    | "createdAt"
    | "defaultBlueprintId"
    | "defaultBranch"
    | "description"
    | "id"
    | "lastRunAt"
    | "name"
    | "repoName"
    | "repoOwner"
    | "repoProvider"
    | "seatLimit"
    | "slug"
    | "workflowMode"
  > & {
    workspaceCount?: number | null;
  },
  provisionerRuntime?: ProvisionerOperatorRuntime | null,
) {
  const serviceByName = new Map(
    (provisionerRuntime?.services ?? []).map((service) => [service.name, service]),
  );
  const repoConfigured = Boolean(
    record.repoProvider && record.repoOwner && record.repoName && record.defaultBranch,
  );
  const provisionerConfigured = Boolean(internalApiEnv.PLATFORM_PROVISIONER_BASE_URL);
  const githubTokenConfigured = Boolean(internalApiEnv.GITHUB_TOKEN);
  const sandboxWorkspaceApiHealthy =
    serviceByName.get("sandbox-workspace-api")?.status === "healthy";
  const sandboxOperatorHealthy = serviceByName.get("sandbox-operator")?.status === "healthy";
  const codexExecutionConfigured = serviceByName.get("codex-execution")?.status === "healthy";
  const issues: string[] = [];

  if (!repoConfigured) {
    issues.push("Configure the GitHub repository owner, name, and default branch.");
  }
  if (!provisionerConfigured) {
    issues.push("Configure the platform workspace-provisioner bridge.");
  }
  if (!githubTokenConfigured) {
    issues.push("Provide a GitHub token so firapps can validate repos and open pull requests.");
  }
  if (provisionerConfigured && provisionerRuntime == null) {
    issues.push("The provisioner runtime snapshot is unavailable.");
  }
  if (provisionerRuntime != null && !sandboxWorkspaceApiHealthy) {
    issues.push("The sandbox workspace API is not healthy.");
  }
  if (provisionerRuntime != null && !sandboxOperatorHealthy) {
    issues.push("The sandbox operator is not healthy.");
  }
  if (provisionerRuntime != null && !codexExecutionConfigured) {
    issues.push("Codex execution is not configured on the provisioner.");
  }

  const dispatchReady = issues.length === 0;
  const readinessStatus = dispatchReady
    ? "ready"
    : !repoConfigured || !provisionerConfigured || !githubTokenConfigured
      ? "blocked"
      : "attention";

  return {
    ...record,
    dispatchReadiness: {
      checks: {
        codexExecutionConfigured: provisionerRuntime != null ? codexExecutionConfigured : null,
        githubTokenConfigured,
        platformProvisionerConfigured: provisionerConfigured,
        repoConfigured,
        sandboxOperatorHealthy: provisionerRuntime != null ? sandboxOperatorHealthy : null,
        sandboxWorkspaceApiHealthy: provisionerRuntime != null ? sandboxWorkspaceApiHealthy : null,
      },
      detail: dispatchReady
        ? "Project can dispatch unattended work through the sandbox execution bridge."
        : issues.join(" "),
      dispatchReady,
      issues,
      status: readinessStatus,
    },
    projectName: record.name,
    projectSlug: record.slug,
    status: record.billingStatus,
    workspaceCount: record.workspaceCount ?? 0,
  };
}

async function loadProvisionerRuntimeSnapshot() {
  if (!internalApiEnv.PLATFORM_PROVISIONER_BASE_URL) {
    return null;
  }

  try {
    return await readProvisionerOperatorRuntime();
  } catch {
    return null;
  }
}

async function updateRunStepStatuses(
  runId: string,
  updates: Array<{
    details?: string | null;
    status: string;
    stepKey: string;
  }>,
) {
  await Promise.all(
    updates.map(async (update) => {
      const nextValues: {
        details?: string | null;
        status: string;
        updatedAt: Date;
      } = {
        status: update.status,
        updatedAt: new Date(),
      };

      if (update.details !== undefined) {
        nextValues.details = update.details;
      }

      await runtime.db
        .update(runSteps)
        .set(nextValues)
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stepKey, update.stepKey)));
    }),
  );
}

async function listRunStepRecords(runId: string) {
  return runtime.db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(runSteps.position);
}

async function updateRunStepRecords(
  updates: Array<{
    details?: string | null;
    runStepId: string;
    status: string;
  }>,
) {
  if (updates.length === 0) {
    return;
  }

  await Promise.all(
    updates.map(async (update) => {
      const nextValues: {
        details?: string | null;
        status: string;
        updatedAt: Date;
      } = {
        status: update.status,
        updatedAt: new Date(),
      };

      if (update.details !== undefined) {
        nextValues.details = update.details;
      }

      await runtime.db.update(runSteps).set(nextValues).where(eq(runSteps.id, update.runStepId));
    }),
  );
}

function buildRunStepRecordUpdate(
  step: RunStepRecord,
  update: {
    details?: string | null;
    status: string;
  },
) {
  const nextDetails = update.details === undefined ? step.details : update.details;

  if (step.status === update.status && step.details === nextDetails) {
    return null;
  }

  return {
    details: update.details,
    runStepId: step.id,
    status: update.status,
  };
}

async function syncRunStepsForWorkspaceReady(runId: string) {
  const steps = await listRunStepRecords(runId);
  const updates = steps.flatMap((step) => {
    if (step.stepKey === "dispatch_received") {
      const update = buildRunStepRecordUpdate(step, {
        details: step.details ?? "Run created and queued.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "provision_devbox") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Isolated devbox is ready for execution.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "clone_repository") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Repository clone completed inside the devbox runtime.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "implement_changes") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Agentic repository mutation will start inside the isolated devbox.",
        status: "queued",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "validate_output") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Validation will run after the agent produces repository changes.",
        status: "queued",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "open_pull_request") {
      const update = buildRunStepRecordUpdate(step, {
        details:
          "A draft pull request will open after the agentic execution artifacts are captured.",
        status: "queued",
      });

      return update ? [update] : [];
    }

    if (step.status === "completed") {
      return [];
    }

    const update = buildRunStepRecordUpdate(step, {
      details: step.details != null ? null : undefined,
      status: "queued",
    });

    return update ? [update] : [];
  });

  await updateRunStepRecords(updates);
}

async function syncRunStepsForCompletedRun(runId: string, prUrl?: string | null) {
  const steps = await listRunStepRecords(runId);
  const updates = steps.flatMap((step) => {
    if (step.stepKey === "dispatch_received") {
      const update = buildRunStepRecordUpdate(step, {
        details: step.details ?? "Run created and queued.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "provision_devbox") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Isolated devbox is ready for execution.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "clone_repository") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Repository clone completed inside the devbox runtime.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "implement_changes") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Codex completed the requested repository changes inside the isolated devbox.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "validate_output") {
      const update = buildRunStepRecordUpdate(step, {
        details:
          "Execution artifacts and validation results were written into the repository branch.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "open_pull_request") {
      const update = buildRunStepRecordUpdate(step, {
        details:
          prUrl != null
            ? `Draft pull request opened: ${prUrl}`
            : "Draft pull request opened for the completed run.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    const update = buildRunStepRecordUpdate(step, {
      details: step.status === "failed" && step.details != null ? null : undefined,
      status: "completed",
    });

    return update ? [update] : [];
  });

  await updateRunStepRecords(updates);
}

async function syncRunStepsForFailedRun(runId: string, failureMessage: string) {
  const steps = await listRunStepRecords(runId);
  const updates = steps.flatMap((step) => {
    if (step.status === "completed") {
      return [];
    }

    const update = buildRunStepRecordUpdate(step, {
      details: failureMessage,
      status: "failed",
    });

    return update ? [update] : [];
  });

  await updateRunStepRecords(updates);
}

async function syncRunStepsForExecutionStarted(runId: string) {
  const steps = await listRunStepRecords(runId);
  const updates = steps.flatMap((step) => {
    if (step.stepKey === "dispatch_received") {
      const update = buildRunStepRecordUpdate(step, {
        details: step.details ?? "Run created and queued.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "provision_devbox") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Isolated devbox is ready for execution.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "clone_repository") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Repository clone completed inside the devbox runtime.",
        status: "completed",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "implement_changes") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Execution bridge is running inside the isolated devbox.",
        status: "in_progress",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "validate_output") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Waiting for execution artifacts from the devbox runtime.",
        status: "queued",
      });

      return update ? [update] : [];
    }

    if (step.stepKey === "open_pull_request") {
      const update = buildRunStepRecordUpdate(step, {
        details: "Draft pull request will open after execution artifacts are captured.",
        status: "queued",
      });

      return update ? [update] : [];
    }

    return [];
  });

  await updateRunStepRecords(updates);
}

function buildExecutionArtifactValues(runId: string, execution: ProvisionerRunExecution) {
  const values: Array<typeof runArtifacts.$inferInsert> = [];

  if (execution.executionLog?.trim()) {
    values.push({
      artifactType: "execution_log",
      label: "Execution log",
      metadata: {},
      runId,
      value: execution.executionLog.trim(),
    });
  }

  if (execution.reportMarkdown?.trim()) {
    values.push({
      artifactType: "execution_report_markdown",
      label: "Execution report markdown",
      metadata: {},
      runId,
      value: execution.reportMarkdown.trim(),
    });
  }

  if (execution.reportPatch?.trim()) {
    values.push({
      artifactType: "execution_report_patch",
      label: "Execution patch",
      metadata: {},
      runId,
      value: execution.reportPatch.trim(),
    });
  }

  if (execution.reportPath?.trim()) {
    values.push({
      artifactType: "execution_report_path",
      label: "Execution report path",
      metadata: {},
      runId,
      value: execution.reportPath.trim(),
    });
  }

  if (execution.repoHeadSha?.trim()) {
    values.push({
      artifactType: "workspace_head_sha",
      label: "Workspace HEAD SHA",
      metadata: {},
      runId,
      value: execution.repoHeadSha.trim(),
    });
  }

  if (execution.repoBranch?.trim()) {
    values.push({
      artifactType: "workspace_branch",
      label: "Workspace branch",
      metadata: {},
      runId,
      value: execution.repoBranch.trim(),
    });
  }

  if (execution.branchUsed?.trim()) {
    values.push({
      artifactType: "workspace_branch_used",
      label: "Published workspace branch",
      metadata: {},
      runId,
      value: execution.branchUsed.trim(),
    });
  }

  if (execution.commitSha?.trim()) {
    values.push({
      artifactType: "workspace_commit_sha",
      label: "Workspace commit SHA",
      metadata: {},
      runId,
      value: execution.commitSha.trim(),
    });
  }

  values.push({
    artifactType: "workspace_push_status",
    label: "Workspace push status",
    metadata: {
      pushSucceeded: execution.pushSucceeded ?? false,
    },
    runId,
    value: execution.pushSucceeded ? "succeeded" : "failed",
  });

  if (execution.pushFailureReason?.trim()) {
    values.push({
      artifactType: "workspace_push_failure_reason",
      label: "Workspace push failure reason",
      metadata: {},
      runId,
      value: execution.pushFailureReason.trim(),
    });
  }

  return values;
}

async function replaceRunExecutionArtifacts(runId: string, execution: ProvisionerRunExecution) {
  await replaceRunArtifacts(
    runId,
    [
      "execution_log",
      "execution_report_markdown",
      "execution_report_patch",
      "execution_report_path",
      "workspace_branch",
      "workspace_branch_used",
      "workspace_commit_sha",
      "workspace_head_sha",
      "workspace_push_failure_reason",
      "workspace_push_status",
    ],
    buildExecutionArtifactValues(runId, execution),
  );
}

async function listRunStepCounts(runIds: string[]) {
  if (runIds.length === 0) {
    return new Map<
      string,
      { completed: number; failed: number; inProgress: number; queued: number; total: number }
    >();
  }

  const records = await runtime.db
    .select({
      runId: runSteps.runId,
      status: runSteps.status,
    })
    .from(runSteps)
    .where(inArray(runSteps.runId, runIds));

  const counts = new Map<
    string,
    {
      completed: number;
      failed: number;
      inProgress: number;
      queued: number;
      total: number;
    }
  >();

  for (const record of records) {
    const current = counts.get(record.runId) ?? {
      completed: 0,
      failed: 0,
      inProgress: 0,
      queued: 0,
      total: 0,
    };

    current.total += 1;

    if (record.status === "completed") {
      current.completed += 1;
    } else if (record.status === "failed") {
      current.failed += 1;
    } else if (record.status === "in_progress" || record.status === "provisioning") {
      current.inProgress += 1;
    } else {
      current.queued += 1;
    }

    counts.set(record.runId, current);
  }

  return counts;
}

async function loadRunResponseContext(runRecords: RunRecord[]) {
  if (runRecords.length === 0) {
    return {
      blueprintById: new Map<string, BlueprintRecord>(),
      projectById: new Map<string, ProjectRecord>(),
      requestorById: new Map<string, RunRequestorRecord>(),
      runIds: [],
      workspaceById: new Map<string, OrganizationWorkspaceRecord>(),
    };
  }

  const runIds = runRecords.map((runRecord) => runRecord.id);
  const tenantIds = [...new Set(runRecords.map((runRecord) => runRecord.tenantId))];
  const blueprintIds = [
    ...new Set(
      runRecords
        .map((runRecord) => runRecord.blueprintId)
        .filter((value): value is string => value != null),
    ),
  ];
  const userIds = [...new Set(runRecords.map((runRecord) => runRecord.requestedByUserId))];
  const workspaceRecordIds = [
    ...new Set(
      runRecords
        .map((runRecord) => runRecord.workspaceRecordId)
        .filter((value): value is string => value != null),
    ),
  ];

  const [projects, blueprintRecords, requestors, workspaceRecords] = await Promise.all([
    runtime.db.select().from(organizationTenants).where(inArray(organizationTenants.id, tenantIds)),
    blueprintIds.length > 0
      ? runtime.db.select().from(blueprints).where(inArray(blueprints.id, blueprintIds))
      : Promise.resolve([]),
    runtime.db.select().from(users).where(inArray(users.id, userIds)),
    workspaceRecordIds.length > 0
      ? runtime.db
          .select()
          .from(organizationWorkspaces)
          .where(inArray(organizationWorkspaces.id, workspaceRecordIds))
      : Promise.resolve([]),
  ]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const blueprintById = new Map(blueprintRecords.map((blueprint) => [blueprint.id, blueprint]));
  const requestorById = new Map(requestors.map((requestor) => [requestor.id, requestor]));
  const workspaceById = new Map(workspaceRecords.map((workspace) => [workspace.id, workspace]));

  return {
    blueprintById,
    projectById,
    requestorById,
    runIds,
    workspaceById,
  };
}

async function loadMergedWorkspaceById(
  workspaceById: Map<string, OrganizationWorkspaceRecord>,
  options: {
    allowStale?: boolean;
  } = {},
) {
  const workspaceRecords = [...workspaceById.values()];

  if (workspaceRecords.length === 0) {
    return new Map<string, OrganizationWorkspaceRecord>();
  }

  let runtimeWorkspaceStateById = new Map<string, ProvisionerWorkspace>();

  try {
    runtimeWorkspaceStateById = await listRuntimeWorkspaceStateByWorkspaceId(workspaceRecords);
  } catch (error) {
    if (!options.allowStale) {
      throw error;
    }

    return new Map(
      workspaceRecords.map((workspaceRecord) => [workspaceRecord.id, workspaceRecord]),
    );
  }

  if (runtimeWorkspaceStateById.size > 0) {
    await syncWorkspaceCache(workspaceRecords, [...runtimeWorkspaceStateById.values()]);
  }

  return new Map(
    workspaceRecords.map((workspaceRecord) => [
      workspaceRecord.id,
      applyProvisionerWorkspaceState(
        workspaceRecord,
        runtimeWorkspaceStateById.get(workspaceRecord.workspaceId),
      ),
    ]),
  );
}

async function buildRunResponseItems(
  runRecords: RunRecord[],
  options: BuildRunResponseOptions = {},
) {
  if (runRecords.length === 0) {
    return [];
  }

  const context = await loadRunResponseContext(runRecords);
  const mergedWorkspaceById = await loadMergedWorkspaceById(context.workspaceById, {
    allowStale: !options.reconcile,
  });
  const reconciled = options.reconcile
    ? await reconcileRunRecords(
        runRecords,
        context.projectById,
        context.requestorById,
        mergedWorkspaceById,
      )
    : {
        runRecords,
        workspaceById: mergedWorkspaceById,
      };
  const stepCounts = await listRunStepCounts(context.runIds);
  const dispatchItems = await buildDispatchResponseItems(
    context.runIds.length > 0
      ? await runtime.db.select().from(dispatches).where(inArray(dispatches.runId, context.runIds))
      : [],
  );
  const dispatchByRunId = new Map(
    dispatchItems
      .filter((dispatchItem) => dispatchItem.runId != null)
      .map((dispatchItem) => [dispatchItem.runId as string, dispatchItem]),
  );

  return reconciled.runRecords.map((runRecord) => {
    const project = context.projectById.get(runRecord.tenantId);
    const blueprint = runRecord.blueprintId
      ? context.blueprintById.get(runRecord.blueprintId)
      : null;
    const requestor = context.requestorById.get(runRecord.requestedByUserId);
    const workspace =
      runRecord.workspaceRecordId != null
        ? reconciled.workspaceById.get(runRecord.workspaceRecordId)
        : null;

    return {
      ...runRecord,
      blueprintName: blueprint?.name ?? null,
      dispatch: dispatchByRunId.get(runRecord.id) ?? null,
      projectName: project?.name ?? null,
      projectSlug: project?.slug ?? null,
      requestedBy: requestor
        ? {
            email: requestor.email,
            id: requestor.id,
            name: requestor.name,
          }
        : null,
      stepCounts: stepCounts.get(runRecord.id) ?? {
        completed: 0,
        failed: 0,
        inProgress: 0,
        queued: 0,
        total: 0,
      },
      workspace: workspace ? mergeWorkspaceRecord(workspace) : null,
    };
  });
}

async function buildRunDetailResponse(runRecord: RunRecord, options: BuildRunResponseOptions = {}) {
  const [item] = await buildRunResponseItems([runRecord], options);
  const runDetailRecord = item ?? runRecord;
  const [steps, artifacts, events] = await Promise.all([
    runtime.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runDetailRecord.id))
      .orderBy(runSteps.position),
    runtime.db
      .select()
      .from(runArtifacts)
      .where(eq(runArtifacts.runId, runDetailRecord.id))
      .orderBy(desc(runArtifacts.createdAt)),
    runtime.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runDetailRecord.id))
      .orderBy(desc(runEvents.createdAt)),
  ]);

  return {
    ...runDetailRecord,
    artifacts,
    events,
    steps,
  };
}

type QueueSnapshotRun = Awaited<ReturnType<typeof buildRunResponseItems>>[number];

function getQueueStage(status: string) {
  const normalizedStatus = status.toLowerCase();

  if (["completed", "workspace_ready"].includes(normalizedStatus)) {
    return "completed" as const;
  }

  if (["failed", "error"].includes(normalizedStatus)) {
    return "failed" as const;
  }

  if (normalizedStatus === "blocked") {
    return "blocked" as const;
  }

  if (["provisioning", "in_progress"].includes(normalizedStatus)) {
    return "provisioning" as const;
  }

  if (normalizedStatus === "queued") {
    return "queued" as const;
  }

  if (["running", "active"].includes(normalizedStatus)) {
    return "active" as const;
  }

  return "other" as const;
}

function toSnapshotTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getQueueReferenceTimestamp(run: QueueSnapshotRun) {
  const queueStage = getQueueStage(run.status);

  if (queueStage === "queued" || queueStage === "blocked") {
    return toSnapshotTimestamp(run.dispatch?.createdAt ?? run.queuedAt ?? run.createdAt);
  }

  return toSnapshotTimestamp(run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt);
}

function getQueueFreshness(run: QueueSnapshotRun) {
  const queueStage = getQueueStage(run.status);
  const referenceTimestamp = getQueueReferenceTimestamp(run);

  if (referenceTimestamp < 1) {
    return {
      ageMinutes: null,
      label: "unknown",
      tone: "neutral" as const,
    };
  }

  const ageMinutes = (Date.now() - referenceTimestamp) / 60_000;
  const warningMinutes = queueStage === "provisioning" || queueStage === "active" ? 30 : 15;
  const dangerMinutes = queueStage === "provisioning" || queueStage === "active" ? 90 : 45;

  if (ageMinutes >= dangerMinutes) {
    return {
      ageMinutes,
      label: "quiet",
      tone: "danger" as const,
    };
  }

  if (ageMinutes >= warningMinutes) {
    return {
      ageMinutes,
      label: "watch",
      tone: "warning" as const,
    };
  }

  return {
    ageMinutes,
    label: "fresh",
    tone: "success" as const,
  };
}

function buildQueueRuntimeCapacity(input: {
  queueRuns: QueueSnapshotRun[];
  runtimeErrorMessage?: string | null;
  runtimeSnapshot: Awaited<ReturnType<typeof readProvisionerOperatorRuntime>> | null;
}) {
  const workspaceSummary = input.runtimeSnapshot?.workspaceSummary;
  const services = input.runtimeSnapshot?.services ?? [];
  const operatorService = services.find((service) => service.name === "sandbox-operator") ?? null;
  const capacityService = services.find((service) => service.name === "sandbox-capacity") ?? null;
  const readyNodes = workspaceSummary?.readyWorkspaceIdeNodes ?? 0;
  const totalNodes = workspaceSummary?.workspaceIdeReadyNodes ?? 0;
  const executingRuns = input.queueRuns.filter((run) =>
    ["active", "provisioning"].includes(getQueueStage(run.status)),
  ).length;
  const waitingRuns = input.queueRuns.filter((run) =>
    ["queued", "blocked"].includes(getQueueStage(run.status)),
  ).length;

  if (!input.runtimeSnapshot) {
    return {
      capacityStatus: "unknown",
      detail: input.runtimeErrorMessage ?? "Provisioner runtime capacity is not available.",
      executingRuns,
      failedWorkspaces: 0,
      operatorStatus: "unknown",
      provisioningWorkspaces: 0,
      readyNodes,
      readyWorkspaces: 0,
      totalNodes,
      totalWorkspaces: 0,
      waitingRuns,
    };
  }

  const readyWorkspaces = workspaceSummary?.ready ?? 0;
  const provisioningWorkspaces = workspaceSummary?.provisioning ?? 0;
  const failedWorkspaces = workspaceSummary?.failed ?? 0;
  const totalWorkspaces = workspaceSummary?.total ?? 0;
  let capacityStatus = capacityService?.status ?? "unknown";
  let detail =
    capacityService?.detail ??
    `${readyNodes}/${totalNodes} workspace-ready nodes are schedulable from the provisioner snapshot.`;

  if (waitingRuns > 0 && readyNodes === 0) {
    capacityStatus = "blocked";
    detail =
      "Queued work is waiting but the provisioner reports no Ready and schedulable workspace nodes.";
  } else if (waitingRuns > readyNodes && readyNodes > 0) {
    capacityStatus = "warning";
    detail = `${waitingRuns} waiting queue items are currently competing for ${readyNodes}/${totalNodes} Ready workspace nodes.`;
  } else if (waitingRuns === 0 && executingRuns === 0 && readyNodes > 0) {
    capacityStatus = "healthy";
    detail = `${readyNodes}/${totalNodes} Ready workspace nodes are available with no queue backlog.`;
  }

  return {
    capacityStatus,
    detail,
    executingRuns,
    failedWorkspaces,
    operatorStatus: operatorService?.status ?? "unknown",
    provisioningWorkspaces,
    readyNodes,
    readyWorkspaces,
    totalNodes,
    totalWorkspaces,
    waitingRuns,
  };
}

async function buildQueueSnapshot(input: { organizationId: string; requestedByUserId?: string }) {
  const filters = [eq(runs.organizationId, input.organizationId)];

  if (input.requestedByUserId) {
    filters.push(eq(runs.requestedByUserId, input.requestedByUserId));
  }

  const [runRecords, activityEventRecords, projectRows, workspaceRows] = await Promise.all([
    runtime.db
      .select()
      .from(runs)
      .where(and(...filters))
      .orderBy(desc(runs.createdAt))
      .limit(100),
    runtime.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.organizationId, input.organizationId))
      .orderBy(desc(activityEvents.occurredAt))
      .limit(25),
    runtime.db
      .select({ id: organizationTenants.id })
      .from(organizationTenants)
      .where(eq(organizationTenants.organizationId, input.organizationId)),
    runtime.db
      .select({ id: organizationWorkspaces.id, status: organizationWorkspaces.status })
      .from(organizationWorkspaces)
      .innerJoin(organizationTenants, eq(organizationWorkspaces.tenantId, organizationTenants.id))
      .where(
        and(
          eq(organizationTenants.organizationId, input.organizationId),
          sql`${organizationWorkspaces.status} <> 'deleted'`,
        ),
      ),
  ]);

  const runItems = await buildRunResponseItems(runRecords);
  const queueRuns = runItems.filter((runItem) =>
    ["queued", "blocked", "provisioning", "active", "other"].includes(
      getQueueStage(runItem.status),
    ),
  );
  let runtimeSnapshot: Awaited<ReturnType<typeof readProvisionerOperatorRuntime>> | null = null;
  let runtimeErrorMessage: string | null = null;

  try {
    runtimeSnapshot = await readProvisionerOperatorRuntime();
  } catch (error) {
    runtimeErrorMessage =
      error instanceof Error ? error.message : "Provisioner runtime capacity probe failed.";
  }

  return {
    activity: activityEventRecords.map((record) => ({
      description: record.description,
      id: record.id,
      kind: record.kind,
      occurredAt: record.occurredAt,
      status: record.status,
      title: record.title,
    })),
    generatedAt: new Date().toISOString(),
    overview: {
      activeRuns: queueRuns.length,
      failedRuns: runItems.filter((runItem) => getQueueStage(runItem.status) === "failed").length,
      pendingInvitations: 0,
      projectCount: projectRows.length,
      readyWorkspaces: workspaceRows.filter((workspaceRow) =>
        workspaceStatusIsReady(workspaceRow.status),
      ).length,
      runCount: runItems.length,
      workspaceCount: workspaceRows.length,
    },
    queueSummary: {
      active: queueRuns.filter((runItem) => getQueueStage(runItem.status) === "active").length,
      blocked: queueRuns.filter((runItem) => getQueueStage(runItem.status) === "blocked").length,
      failed: runItems.filter((runItem) => getQueueStage(runItem.status) === "failed").length,
      provisioning: queueRuns.filter((runItem) => getQueueStage(runItem.status) === "provisioning")
        .length,
      queued: queueRuns.filter((runItem) => getQueueStage(runItem.status) === "queued").length,
      quiet: queueRuns.filter((runItem) => getQueueFreshness(runItem).tone === "danger").length,
      queueRuns: queueRuns.length,
    },
    runtimeCapacity: buildQueueRuntimeCapacity({
      queueRuns,
      runtimeErrorMessage,
      runtimeSnapshot,
    }),
    runs: runItems,
  };
}

async function buildQueueMetricsSnapshot(input: { organizationId: string }) {
  const [runRecords, projectRows, workspaceRows] = await Promise.all([
    runtime.db
      .select()
      .from(runs)
      .where(eq(runs.organizationId, input.organizationId))
      .orderBy(desc(runs.createdAt))
      .limit(100),
    runtime.db
      .select({ id: organizationTenants.id })
      .from(organizationTenants)
      .where(eq(organizationTenants.organizationId, input.organizationId)),
    runtime.db
      .select({ id: organizationWorkspaces.id, status: organizationWorkspaces.status })
      .from(organizationWorkspaces)
      .innerJoin(organizationTenants, eq(organizationWorkspaces.tenantId, organizationTenants.id))
      .where(
        and(
          eq(organizationTenants.organizationId, input.organizationId),
          sql`${organizationWorkspaces.status} <> 'deleted'`,
        ),
      ),
  ]);
  const runItems = await buildRunResponseItems(runRecords);
  const queueRuns = runItems.filter((runItem) =>
    ["queued", "blocked", "provisioning", "active", "other"].includes(
      getQueueStage(runItem.status),
    ),
  );
  let runtimeSnapshot: Awaited<ReturnType<typeof readProvisionerOperatorRuntime>> | null = null;
  let runtimeErrorMessage: string | null = null;

  try {
    runtimeSnapshot = await readProvisionerOperatorRuntime();
  } catch (error) {
    runtimeErrorMessage =
      error instanceof Error ? error.message : "Provisioner runtime capacity probe failed.";
  }

  return {
    electricEnabled: electricSyncConfigured(),
    generatedAt: new Date().toISOString(),
    overview: {
      activeRuns: queueRuns.length,
      failedRuns: runItems.filter((runItem) => getQueueStage(runItem.status) === "failed").length,
      pendingInvitations: 0,
      projectCount: projectRows.length,
      readyWorkspaces: workspaceRows.filter((workspaceRow) =>
        workspaceStatusIsReady(workspaceRow.status),
      ).length,
      runCount: runItems.length,
      workspaceCount: workspaceRows.length,
    },
    runtimeCapacity: buildQueueRuntimeCapacity({
      queueRuns,
      runtimeErrorMessage,
      runtimeSnapshot,
    }),
  };
}

async function createRunArtifactsForWorkspace(input: {
  runId: string;
  workspace: OrganizationWorkspaceRecord;
}) {
  const values: Array<typeof runArtifacts.$inferInsert> = [
    {
      artifactType: "workspace_id",
      label: "Workspace ID",
      metadata: {},
      runId: input.runId,
      url: null,
      value: input.workspace.workspaceId,
    },
  ];

  if (input.workspace.ideUrl) {
    values.push({
      artifactType: "ide_url",
      label: "Devbox IDE",
      metadata: {},
      runId: input.runId,
      url: input.workspace.ideUrl,
      value: input.workspace.ideUrl,
    });
  }

  await runtime.db.insert(runArtifacts).values(values);
}

async function provisionWorkspaceForRun(input: {
  blueprint: BlueprintRecord | null;
  branchName?: string | null;
  dispatchRecord?: DispatchRecord | null;
  organizationId: string;
  project: ProjectRecord;
  runId: string;
  runTitle: string;
}) {
  if (
    !internalApiEnv.PLATFORM_PROVISIONER_BASE_URL ||
    !input.project.repoProvider ||
    !input.project.repoOwner ||
    !input.project.repoName
  ) {
    return {
      status: !internalApiEnv.PLATFORM_PROVISIONER_BASE_URL ? "queued" : "blocked",
      summary: !internalApiEnv.PLATFORM_PROVISIONER_BASE_URL
        ? "Run queued. The workspace provisioner is not configured yet."
        : "Run blocked. Configure the project repository before dispatching unattended work.",
      workspace: null,
      workspaceState: null,
    };
  }

  const workspaceState = await createProvisionerWorkspace({
    blueprintId: input.blueprint?.id ?? null,
    blueprintName: input.blueprint?.name ?? null,
    dispatchId: input.dispatchRecord?.id ?? null,
    imageFlavor: "full",
    nixPackages: [],
    organizationId: input.organizationId,
    provider: "daytona",
    projectId: input.project.id,
    projectName: input.project.name,
    projectSlug: input.project.slug,
    branchName: input.branchName ?? null,
    repoName: input.project.repoName,
    repoOwner: input.project.repoOwner,
    repoProvider: input.project.repoProvider,
    runId: input.runId,
    runTitle: input.runTitle,
    tenantId: input.project.id,
    tenantName: input.project.name,
    tenantSlug: input.project.slug,
    workspaceId: buildWorkspaceId(input.project.slug),
  });

  const [workspace] = await runtime.db
    .insert(organizationWorkspaces)
    .values({
      ideUrl: workspaceState.ideUrl ?? null,
      imageFlavor: workspaceState.imageFlavor ?? "full",
      nixPackages: workspaceState.nixPackages ?? [],
      previewUrl: workspaceState.previewUrl ?? null,
      provider: workspaceState.provider ?? "daytona",
      repoName: input.project.repoName,
      repoOwner: input.project.repoOwner,
      repoProvider: input.project.repoProvider,
      status: workspaceState.status,
      tenantId: input.project.id,
      updatedAt: workspaceState.updatedAt ?? new Date(),
      workspaceId: workspaceState.workspaceId,
    })
    .returning();

  await createRunArtifactsForWorkspace({
    runId: input.runId,
    workspace,
  });

  return {
    status: workspaceState.status === "ready" ? "workspace_ready" : "provisioning",
    summary:
      workspaceState.status === "ready"
        ? "Run accepted. The isolated devbox is ready for the execution bridge."
        : "Run accepted. The isolated devbox is provisioning.",
    workspace,
    workspaceState,
  };
}

function workspaceStatusIsReady(status: string | null | undefined) {
  return ["active", "available", "ready", "running"].includes((status ?? "").toLowerCase());
}

function workspaceStatusIsFailed(status: string | null | undefined) {
  return ["deleted", "error", "failed"].includes((status ?? "").toLowerCase());
}

async function replaceRunArtifacts(
  runId: string,
  artifactTypes: string[],
  values: Array<typeof runArtifacts.$inferInsert>,
) {
  if (artifactTypes.length > 0) {
    await runtime.db
      .delete(runArtifacts)
      .where(and(eq(runArtifacts.runId, runId), inArray(runArtifacts.artifactType, artifactTypes)));
  }

  if (values.length > 0) {
    await runtime.db.insert(runArtifacts).values(values);
  }
}

async function listRuntimeWorkspaceStateByWorkspaceId(
  workspaceRecords: OrganizationWorkspaceRecord[],
) {
  if (workspaceRecords.length === 0) {
    return new Map<string, ProvisionerWorkspace>();
  }

  const workspaceIdsByTenant = new Map<string, string[]>();

  for (const workspaceRecord of workspaceRecords) {
    const current = workspaceIdsByTenant.get(workspaceRecord.tenantId) ?? [];
    current.push(workspaceRecord.workspaceId);
    workspaceIdsByTenant.set(workspaceRecord.tenantId, current);
  }

  const settled = await Promise.allSettled(
    [...workspaceIdsByTenant.entries()].map(async ([tenantId, workspaceIds]) =>
      listProvisionerWorkspaces({
        tenantId,
        workspaceIds,
      }),
    ),
  );
  const runtimeStates = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  return new Map(runtimeStates.map((runtimeState) => [runtimeState.workspaceId, runtimeState]));
}

async function markRunReadyForExecution(
  runRecord: RunRecord,
  workspace: OrganizationWorkspaceRecord,
) {
  if (runRecord.status === "workspace_ready" && !runRecord.prUrl) {
    return {
      ...runRecord,
      resultSummary:
        runRecord.resultSummary ??
        "Run reached a ready devbox. Agentic repository execution is about to continue inside the isolated runtime.",
      workspaceRecordId: workspace.id,
    };
  }

  const updatedAt = new Date();
  const resultSummary =
    "Run reached a ready devbox. Agentic repository execution is about to continue inside the isolated runtime.";

  await runtime.db
    .update(runs)
    .set({
      resultSummary,
      startedAt: runRecord.startedAt ?? updatedAt,
      status: "workspace_ready",
      updatedAt,
      workspaceRecordId: workspace.id,
    })
    .where(eq(runs.id, runRecord.id));

  await syncRunStepsForWorkspaceReady(runRecord.id);

  await recordRunLifecycleEvent({
    actorUserId: runRecord.requestedByUserId,
    blueprintId: runRecord.blueprintId,
    description: `Run ${runRecord.title} reached a ready devbox.`,
    eventKind: "run_workspace_ready",
    message: resultSummary,
    metadata: {
      workspaceId: workspace.workspaceId,
      workspaceStatus: workspace.status,
    },
    organizationId: runRecord.organizationId,
    runId: runRecord.id,
    status: "workspace_ready",
    tenantId: runRecord.tenantId,
    title: runRecord.title,
    workspaceRecordId: workspace.id,
  });

  return {
    ...runRecord,
    resultSummary,
    startedAt: runRecord.startedAt ?? updatedAt,
    status: "workspace_ready",
    updatedAt,
    workspaceRecordId: workspace.id,
  };
}

async function markRunFailed(runRecord: RunRecord, failureMessage: string, summary: string) {
  const updatedAt = new Date();

  await runtime.db
    .update(runs)
    .set({
      failureMessage,
      resultSummary: summary,
      status: "failed",
      updatedAt,
    })
    .where(eq(runs.id, runRecord.id));

  await syncRunStepsForFailedRun(runRecord.id, failureMessage);

  await recordRunLifecycleEvent({
    actorUserId: runRecord.requestedByUserId,
    blueprintId: runRecord.blueprintId,
    description: `Run ${runRecord.title} failed.`,
    eventKind: "run_failed",
    level: "error",
    message: failureMessage,
    metadata: {
      summary,
    },
    organizationId: runRecord.organizationId,
    runId: runRecord.id,
    status: "failed",
    tenantId: runRecord.tenantId,
    title: runRecord.title,
  });

  return {
    ...runRecord,
    failureMessage,
    resultSummary: summary,
    status: "failed",
    updatedAt,
  };
}

async function markRunExecutionInProgress(
  runRecord: RunRecord,
  workspace: OrganizationWorkspaceRecord,
) {
  if (runRecord.status === "in_progress") {
    return {
      ...runRecord,
      resultSummary:
        runRecord.resultSummary ?? "Run is executing inside the isolated devbox runtime.",
      workspaceRecordId: workspace.id,
    };
  }

  const updatedAt = new Date();
  const resultSummary = "Run is executing inside the isolated devbox runtime.";

  await runtime.db
    .update(runs)
    .set({
      failureMessage: null,
      resultSummary,
      startedAt: runRecord.startedAt ?? updatedAt,
      status: "in_progress",
      updatedAt,
      workspaceRecordId: workspace.id,
    })
    .where(eq(runs.id, runRecord.id));

  await syncRunStepsForExecutionStarted(runRecord.id);

  await recordRunLifecycleEvent({
    actorUserId: runRecord.requestedByUserId,
    blueprintId: runRecord.blueprintId,
    description: `Run ${runRecord.title} started executing inside devbox ${workspace.workspaceId}.`,
    eventKind: "run_execution_started",
    message: resultSummary,
    metadata: {
      workspaceId: workspace.workspaceId,
      workspaceStatus: workspace.status,
    },
    organizationId: runRecord.organizationId,
    runId: runRecord.id,
    status: "in_progress",
    stepKey: "implement_changes",
    tenantId: runRecord.tenantId,
    title: runRecord.title,
    workspaceRecordId: workspace.id,
  });

  return {
    ...runRecord,
    failureMessage: null,
    resultSummary,
    startedAt: runRecord.startedAt ?? updatedAt,
    status: "in_progress",
    updatedAt,
    workspaceRecordId: workspace.id,
  };
}

async function executeRunWithWorkspaceBridge(input: {
  project: ProjectRecord;
  runRecord: RunRecord;
  workspace: OrganizationWorkspaceRecord;
  requestor?: { email: string; name: string } | null;
}) {
  let executionRecord = input.runRecord;
  const blueprint =
    input.runRecord.blueprintId != null
      ? await getAccessibleBlueprintRecord(
          input.runRecord.organizationId,
          input.runRecord.blueprintId,
        )
      : null;
  const blueprintExecutionPlan = buildBlueprintExecutionPlan(blueprint);

  try {
    const execution = await executeProvisionerWorkspaceRun({
      branchName: input.runRecord.branchName ?? null,
      blueprintName: blueprint?.name ?? null,
      executionPlan: blueprintExecutionPlan,
      objective: input.runRecord.objective,
      projectName: input.project.name,
      repoName: input.project.repoName ?? "",
      repoOwner: input.project.repoOwner ?? "",
      runId: input.runRecord.id,
      runTitle: input.runRecord.title,
      workspaceId: input.workspace.workspaceId,
    });

    await replaceRunExecutionArtifacts(input.runRecord.id, execution);

    if (execution.status === "failed") {
      const failureMessage =
        execution.failureMessage?.trim() ||
        execution.summary.trim() ||
        "Workspace execution failed inside the isolated devbox.";

      await recordRunLifecycleEvent({
        actorUserId: input.runRecord.requestedByUserId,
        blueprintId: input.runRecord.blueprintId,
        description: `Run ${input.runRecord.title} failed during workspace execution.`,
        eventKind: "run_execution_failed",
        level: "error",
        message: failureMessage,
        metadata: {
          reportPath: execution.reportPath ?? null,
          workspaceId: execution.workspaceId,
        },
        organizationId: input.runRecord.organizationId,
        runId: input.runRecord.id,
        status: "failed",
        stepKey: "implement_changes",
        tenantId: input.runRecord.tenantId,
        title: input.runRecord.title,
        workspaceRecordId: input.workspace.id,
      });

      await markRunFailed(
        {
          ...input.runRecord,
          workspaceRecordId: input.workspace.id,
        },
        failureMessage,
        "Run failed while executing inside the isolated devbox runtime.",
      );
      return;
    }

    const executionSummary = execution.summary.trim();
    const updatedAt = new Date();
    const branchName = execution.branchName?.trim() || input.runRecord.branchName || null;

    await runtime.db
      .update(runs)
      .set({
        branchName,
        resultSummary: executionSummary,
        updatedAt,
        workspaceRecordId: input.workspace.id,
      })
      .where(eq(runs.id, input.runRecord.id));

    await updateRunStepStatuses(input.runRecord.id, [
      {
        details: "Execution bridge completed inside the isolated devbox.",
        status: "completed",
        stepKey: "implement_changes",
      },
      {
        details: "Execution artifacts were captured from the devbox runtime.",
        status: "completed",
        stepKey: "validate_output",
      },
      {
        details: buildOpenPullRequestStepDetails(execution),
        status: "in_progress",
        stepKey: "open_pull_request",
      },
    ]);

    await recordRunLifecycleEvent({
      actorUserId: input.runRecord.requestedByUserId,
      blueprintId: input.runRecord.blueprintId,
      description: `Run ${input.runRecord.title} completed workspace execution and produced review artifacts.`,
      eventKind: "run_execution_completed",
      message: executionSummary,
      metadata: {
        branchName,
        branchUsed: execution.branchUsed ?? null,
        commitSha: execution.commitSha ?? null,
        pushFailureReason: execution.pushFailureReason ?? null,
        pushSucceeded: execution.pushSucceeded ?? false,
        repoBranch: execution.repoBranch ?? null,
        repoHeadSha: execution.repoHeadSha ?? null,
        reportPath: execution.reportPath ?? null,
        workspaceId: execution.workspaceId,
      },
      organizationId: input.runRecord.organizationId,
      runId: input.runRecord.id,
      status: "in_progress",
      stepKey: "implement_changes",
      tenantId: input.runRecord.tenantId,
      title: input.runRecord.title,
      workspaceRecordId: input.workspace.id,
    });

    executionRecord = {
      ...input.runRecord,
      branchName,
      resultSummary: executionSummary,
      updatedAt,
      workspaceRecordId: input.workspace.id,
    };

    try {
      await completeRunWithPullRequest({
        execution,
        project: input.project,
        requestor: input.requestor ?? null,
        runRecord: executionRecord,
        workspace: input.workspace,
      });
    } catch (error) {
      const failureMessage =
        error instanceof GitHubIntegrationError
          ? error.message
          : "Workspace execution completed but draft pull request creation failed.";

      await recordRunLifecycleEvent({
        actorUserId: input.runRecord.requestedByUserId,
        blueprintId: input.runRecord.blueprintId,
        description: `Run ${input.runRecord.title} failed while opening the draft pull request.`,
        eventKind: "run_pull_request_failed",
        level: "error",
        message: failureMessage,
        metadata: {
          branchName,
          branchUsed: execution.branchUsed ?? null,
          commitSha: execution.commitSha ?? null,
          pushFailureReason: execution.pushFailureReason ?? null,
          pushSucceeded: execution.pushSucceeded ?? false,
          reportPath: execution.reportPath ?? null,
          workspaceId: execution.workspaceId,
        },
        organizationId: input.runRecord.organizationId,
        runId: input.runRecord.id,
        status: "failed",
        stepKey: "open_pull_request",
        tenantId: input.runRecord.tenantId,
        title: input.runRecord.title,
        workspaceRecordId: input.workspace.id,
      });

      await markRunFailed(
        executionRecord,
        failureMessage,
        "Run executed in the devbox but failed while opening the GitHub pull request path.",
      );
    }
  } catch (error) {
    const failureMessage =
      error instanceof ProvisionerError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Workspace execution bridge failed unexpectedly.";

    await recordRunLifecycleEvent({
      actorUserId: input.runRecord.requestedByUserId,
      blueprintId: input.runRecord.blueprintId,
      description: `Run ${input.runRecord.title} hit an execution-bridge failure.`,
      eventKind: "run_execution_bridge_failed",
      level: "error",
      message: failureMessage,
      metadata: {
        workspaceId: input.workspace.workspaceId,
      },
      organizationId: input.runRecord.organizationId,
      runId: input.runRecord.id,
      status: "failed",
      stepKey: "implement_changes",
      tenantId: input.runRecord.tenantId,
      title: input.runRecord.title,
      workspaceRecordId: input.workspace.id,
    });

    await markRunFailed(
      executionRecord,
      failureMessage,
      "Run failed while the workspace execution bridge was collecting execution artifacts.",
    );
  }
}

function requestRunExecution(input: {
  project: ProjectRecord;
  runRecord: RunRecord;
  workspace: OrganizationWorkspaceRecord;
  requestor?: { email: string; name: string } | null;
}) {
  if (runExecutionInFlight.has(input.runRecord.id)) {
    return;
  }

  runExecutionInFlight.add(input.runRecord.id);

  void executeRunWithWorkspaceBridge(input)
    .catch((error) => {
      console.error("[internal-api] workspace execution bridge failed", error);
    })
    .finally(() => {
      runExecutionInFlight.delete(input.runRecord.id);
    });
}

function buildOpenPullRequestStepDetails(execution: ProvisionerRunExecution) {
  const publishedBranch = execution.branchUsed?.trim() || execution.branchName?.trim() || null;

  if (execution.pushSucceeded && publishedBranch) {
    return `Opening a draft pull request from published workspace branch ${publishedBranch}.`;
  }

  if (execution.pushFailureReason?.trim()) {
    return `Publishing the execution report to a draft GitHub pull request because workspace push fell back: ${execution.pushFailureReason.trim()}`;
  }

  return "Publishing the execution report to a draft GitHub pull request.";
}

function buildCompletedRunResultSummary(input: {
  execution?: ProvisionerRunExecution | null;
  pullRequest: {
    branchName: string;
  };
}) {
  if (input.execution?.pushSucceeded && input.execution.branchUsed?.trim()) {
    return `${input.execution.summary} Draft GitHub pull request opened from published workspace branch ${input.pullRequest.branchName}.`;
  }

  if (input.execution?.pushFailureReason?.trim()) {
    return `${input.execution.summary} Draft GitHub pull request opened via the report-publish fallback after workspace push failed: ${input.execution.pushFailureReason.trim()}.`;
  }

  return (
    input.execution?.summary ??
    "Run completed. A draft GitHub pull request now carries the execution report artifact for review."
  );
}

async function completeRunWithPullRequest(input: {
  execution?: ProvisionerRunExecution | null;
  project: ProjectRecord;
  runRecord: RunRecord;
  workspace: OrganizationWorkspaceRecord;
  requestor?: { email: string; name: string } | null;
}) {
  const pullRequest = await createRunPullRequest({
    branchName: input.runRecord.branchName,
    defaultBranch: input.project.defaultBranch,
    objective: input.runRecord.objective,
    organizationName: null,
    publishedBranchName:
      input.execution?.pushSucceeded && input.execution.branchUsed?.trim()
        ? input.execution.branchUsed.trim()
        : null,
    publishedCommitSha:
      input.execution?.pushSucceeded && input.execution.commitSha?.trim()
        ? input.execution.commitSha.trim()
        : null,
    projectName: input.project.name,
    repoName: input.project.repoName ?? "",
    repoOwner: input.project.repoOwner ?? "",
    requestedByEmail: input.requestor?.email ?? null,
    requestedByName: input.requestor?.name ?? null,
    reportMarkdown: input.execution?.reportMarkdown ?? null,
    runId: input.runRecord.id,
    runTitle: input.runRecord.title,
    summary:
      input.runRecord.resultSummary ??
      input.execution?.summary ??
      "Run completed on the local-first MVP happy path and produced a draft GitHub pull request.",
    workspacePushFailureReason: input.execution?.pushFailureReason ?? null,
  });
  const completedAt = new Date();
  const resultSummary = buildCompletedRunResultSummary({
    execution: input.execution,
    pullRequest,
  });

  await runtime.db
    .update(runs)
    .set({
      branchName: pullRequest.branchName,
      completedAt,
      failureMessage: null,
      prUrl: pullRequest.prUrl,
      resultSummary,
      startedAt: input.runRecord.startedAt ?? completedAt,
      status: "completed",
      updatedAt: completedAt,
      workspaceRecordId: input.workspace.id,
    })
    .where(eq(runs.id, input.runRecord.id));

  await syncRunStepsForCompletedRun(input.runRecord.id, pullRequest.prUrl);

  await replaceRunArtifacts(
    input.runRecord.id,
    ["branch_name", "commit_sha", "pull_request", "run_report_path"],
    [
      {
        artifactType: "branch_name",
        label: "Branch name",
        metadata: {},
        runId: input.runRecord.id,
        value: pullRequest.branchName,
      },
      {
        artifactType: "commit_sha",
        label: "Commit SHA",
        metadata: {},
        runId: input.runRecord.id,
        value: pullRequest.commitSha,
      },
      {
        artifactType: "pull_request",
        label: "Draft pull request",
        metadata: {
          number: String(pullRequest.prNumber),
        },
        runId: input.runRecord.id,
        url: pullRequest.prUrl,
        value: pullRequest.prUrl,
      },
      {
        artifactType: "run_report_path",
        label: "Run report path",
        metadata: {},
        runId: input.runRecord.id,
        value: input.execution?.reportPath ?? pullRequest.filePath,
      },
    ],
  );

  await Promise.all([
    recordRunLifecycleEvent({
      actorUserId: input.runRecord.requestedByUserId,
      blueprintId: input.runRecord.blueprintId,
      description: `Run ${input.runRecord.title} created branch ${pullRequest.branchName}.`,
      eventKind: "run_branch_created",
      message: `Branch ${pullRequest.branchName} created for the run.`,
      metadata: {
        branchName: pullRequest.branchName,
        commitSha: pullRequest.commitSha,
        workspaceBranch: input.execution?.branchUsed ?? null,
        workspacePushSucceeded: input.execution?.pushSucceeded ?? false,
      },
      organizationId: input.runRecord.organizationId,
      runId: input.runRecord.id,
      status: "completed",
      tenantId: input.runRecord.tenantId,
      title: input.runRecord.title,
      workspaceRecordId: input.workspace.id,
    }),
    recordRunLifecycleEvent({
      actorUserId: input.runRecord.requestedByUserId,
      blueprintId: input.runRecord.blueprintId,
      description: `Run ${input.runRecord.title} opened a draft pull request.`,
      eventKind: "run_pull_request_opened",
      message: `Draft pull request opened: ${pullRequest.prUrl}`,
      metadata: {
        branchName: pullRequest.branchName,
        commitSha: pullRequest.commitSha,
        prNumber: String(pullRequest.prNumber),
        prUrl: pullRequest.prUrl,
        reportPath: input.execution?.reportPath ?? pullRequest.filePath,
        workspaceBranch: input.execution?.branchUsed ?? null,
        workspacePushFailureReason: input.execution?.pushFailureReason ?? null,
        workspacePushSucceeded: input.execution?.pushSucceeded ?? false,
      },
      organizationId: input.runRecord.organizationId,
      runId: input.runRecord.id,
      status: "completed",
      tenantId: input.runRecord.tenantId,
      title: input.runRecord.title,
      workspaceRecordId: input.workspace.id,
    }),
  ]);

  return {
    ...input.runRecord,
    branchName: pullRequest.branchName,
    completedAt,
    failureMessage: null,
    prUrl: pullRequest.prUrl,
    resultSummary,
    startedAt: input.runRecord.startedAt ?? completedAt,
    status: "completed",
    updatedAt: completedAt,
    workspaceRecordId: input.workspace.id,
  };
}

async function reconcileRunRecords(
  runRecords: RunRecord[],
  projectById: Map<string, ProjectRecord>,
  requestorById: Map<string, RunRequestorRecord>,
  workspaceById: Map<string, OrganizationWorkspaceRecord>,
) {
  const reconciledRunRecords = await Promise.all(
    runRecords.map(async (runRecord) => {
      if (!runRecord.workspaceRecordId) {
        return runRecord;
      }

      const project = projectById.get(runRecord.tenantId);
      const workspace = workspaceById.get(runRecord.workspaceRecordId);

      if (!project || !workspace) {
        return runRecord;
      }

      if (workspaceStatusIsFailed(workspace.status)) {
        return markRunFailed(
          runRecord,
          `Devbox ${workspace.workspaceId} entered terminal state ${workspace.status}.`,
          "Run failed after the sandbox devbox entered a terminal runtime state.",
        );
      }

      if (!workspaceStatusIsReady(workspace.status)) {
        return runRecord;
      }

      if (runRecord.prUrl) {
        if (runRecord.status === "completed") {
          return runRecord;
        }

        const updatedAt = new Date();
        await runtime.db
          .update(runs)
          .set({
            completedAt: runRecord.completedAt ?? updatedAt,
            resultSummary:
              runRecord.resultSummary ??
              "Run completed. The GitHub pull request artifact is already recorded.",
            startedAt: runRecord.startedAt ?? updatedAt,
            status: "completed",
            updatedAt,
          })
          .where(eq(runs.id, runRecord.id));

        await syncRunStepsForCompletedRun(runRecord.id, runRecord.prUrl);

        await recordRunLifecycleEvent({
          actorUserId: runRecord.requestedByUserId,
          blueprintId: runRecord.blueprintId,
          description: `Run ${runRecord.title} completed with an existing pull request artifact.`,
          eventKind: "run_completed",
          message: "Existing pull request artifact confirmed.",
          metadata: {
            prUrl: runRecord.prUrl,
          },
          organizationId: runRecord.organizationId,
          runId: runRecord.id,
          status: "completed",
          tenantId: runRecord.tenantId,
          title: runRecord.title,
          workspaceRecordId: workspace.id,
        });

        return {
          ...runRecord,
          completedAt: runRecord.completedAt ?? updatedAt,
          resultSummary:
            runRecord.resultSummary ??
            "Run completed. The GitHub pull request artifact is already recorded.",
          startedAt: runRecord.startedAt ?? updatedAt,
          status: "completed",
          updatedAt,
        };
      }

      if (
        project.repoProvider !== "github" ||
        !project.repoOwner ||
        !project.repoName ||
        !internalApiEnv.GITHUB_TOKEN
      ) {
        return markRunReadyForExecution(runRecord, workspace);
      }

      const executionRunRecord = await markRunExecutionInProgress(runRecord, workspace);

      requestRunExecution({
        project,
        requestor: requestorById.get(runRecord.requestedByUserId) ?? null,
        runRecord: executionRunRecord,
        workspace,
      });

      return executionRunRecord;
    }),
  );

  return {
    runRecords: reconciledRunRecords,
    workspaceById,
  };
}

function runStatusIsActive(status: string) {
  return activeRunStatuses.includes(status as (typeof activeRunStatuses)[number]);
}

const terminalRunStatuses = ["completed", "failed"] as const;

function runNeedsReconciliation(runRecord: Pick<RunRecord, "status" | "workspaceRecordId">) {
  return runRecord.workspaceRecordId != null && runStatusIsActive(runRecord.status);
}

async function reconcileActiveRuns() {
  const activeRunRecords = await runtime.db
    .select()
    .from(runs)
    .where(and(inArray(runs.status, [...activeRunStatuses]), isNotNull(runs.workspaceRecordId)))
    .orderBy(desc(runs.updatedAt))
    .limit(50);

  if (activeRunRecords.length === 0) {
    return;
  }

  const context = await loadRunResponseContext(activeRunRecords);
  const mergedWorkspaceById = await loadMergedWorkspaceById(context.workspaceById);

  await reconcileRunRecords(
    activeRunRecords,
    context.projectById,
    context.requestorById,
    mergedWorkspaceById,
  );
}

async function reclaimRetiredRunWorkspaces() {
  if (
    !internalApiEnv.PLATFORM_PROVISIONER_BASE_URL ||
    internalApiEnv.RUN_WORKSPACE_RETENTION_MS < 1
  ) {
    return;
  }

  const cutoff = new Date(Date.now() - internalApiEnv.RUN_WORKSPACE_RETENTION_MS);
  const candidates = await runtime.db
    .select({
      runRecord: runs,
      workspaceRecord: organizationWorkspaces,
    })
    .from(runs)
    .innerJoin(organizationWorkspaces, eq(runs.workspaceRecordId, organizationWorkspaces.id))
    .where(
      and(
        inArray(runs.status, [...terminalRunStatuses]),
        sql`coalesce(${runs.completedAt}, ${runs.updatedAt}, ${runs.createdAt}) < ${cutoff}`,
        sql`${organizationWorkspaces.status} <> 'deleted'`,
      ),
    )
    .limit(25);

  if (candidates.length === 0) {
    return;
  }

  await Promise.all(
    candidates.map(async ({ runRecord, workspaceRecord }) => {
      try {
        await deleteProvisionerWorkspace(workspaceRecord.workspaceId);
      } catch (error) {
        if (!(error instanceof ProvisionerError && error.status === 404)) {
          throw error;
        }
      }

      const updatedAt = new Date();

      await runtime.db
        .update(organizationWorkspaces)
        .set({
          ideUrl: null,
          previewUrl: null,
          status: "deleted",
          updatedAt,
        })
        .where(eq(organizationWorkspaces.id, workspaceRecord.id));

      await recordRunLifecycleEvent({
        actorUserId: runRecord.requestedByUserId,
        blueprintId: runRecord.blueprintId,
        description: `Devbox ${workspaceRecord.workspaceId} was reclaimed after run ${runRecord.title} reached terminal state ${runRecord.status}.`,
        eventKind: "run_workspace_reclaimed",
        message:
          "Run-linked devbox reclaimed after the local retention window to keep sandbox capacity available for later work.",
        metadata: {
          reclaimedAfterMs: internalApiEnv.RUN_WORKSPACE_RETENTION_MS,
          workspaceId: workspaceRecord.workspaceId,
          workspaceStatusBeforeCleanup: workspaceRecord.status,
        },
        organizationId: runRecord.organizationId,
        runId: runRecord.id,
        status: "deleted",
        tenantId: runRecord.tenantId,
        title: runRecord.title,
        workspaceRecordId: workspaceRecord.id,
      });
    }),
  );
}

function requestActiveRunReconciliation() {
  runReconciliationRequested = true;

  if (runReconciliationInFlight) {
    return;
  }

  runReconciliationInFlight = (async () => {
    while (runReconciliationRequested) {
      runReconciliationRequested = false;

      try {
        await reconcileActiveRuns();
        await reclaimRetiredRunWorkspaces();
      } catch (error) {
        console.error("[internal-api] run maintenance loop failed", error);
      }
    }
  })().finally(() => {
    runReconciliationInFlight = null;
  });
}

async function createRunWithProvisioning(input: {
  blueprint: BlueprintRecord | null;
  dispatchRecord?: DispatchRecord | null;
  objective: string;
  organizationId: string;
  project: ProjectRecord;
  requestedByUserId: string;
  source: z.infer<typeof runSourceSchema>;
  title: string;
}) {
  const [runRecord] = await runtime.db
    .insert(runs)
    .values({
      blueprintId: input.blueprint?.id ?? null,
      objective: input.objective,
      organizationId: input.organizationId,
      requestedByUserId: input.requestedByUserId,
      source: input.source,
      status: "queued",
      tenantId: input.project.id,
      title: input.title,
    })
    .returning();

  const branchName =
    input.project.repoProvider && input.project.repoOwner && input.project.repoName
      ? buildRunBranchName(runRecord.id)
      : null;
  const runRecordWithBranch =
    branchName != null
      ? {
          ...runRecord,
          branchName,
          updatedAt: new Date(),
        }
      : runRecord;

  if (branchName != null) {
    await runtime.db
      .update(runs)
      .set({
        branchName,
        updatedAt: runRecordWithBranch.updatedAt,
      })
      .where(eq(runs.id, runRecord.id));
  }

  if (input.dispatchRecord) {
    await runtime.db
      .update(dispatches)
      .set({
        runId: runRecordWithBranch.id,
        updatedAt: new Date(),
      })
      .where(eq(dispatches.id, input.dispatchRecord.id));
  }

  const stepDefinitions = resolveBlueprintSteps(input.blueprint);

  await runtime.db.insert(runSteps).values(
    stepDefinitions.map((step, index) => ({
      details: index === 0 ? "Run created and queued." : null,
      label: step.label,
      position: index,
      runId: runRecordWithBranch.id,
      status: index === 0 ? "completed" : "queued",
      stepKey: step.key,
      stepKind: step.kind,
    })),
  );

  await recordRunLifecycleEvent({
    actorUserId: input.requestedByUserId,
    blueprintId: input.blueprint?.id ?? null,
    description: `Run ${input.title} was dispatched for ${input.project.name}.`,
    eventKind: "run_dispatched",
    message: "Run dispatched into the execution pipeline.",
    metadata: {
      branchName,
      dispatchId: input.dispatchRecord?.id ?? null,
      projectSlug: input.project.slug,
      source: input.source,
      workflowMode: input.project.workflowMode,
    },
    organizationId: input.organizationId,
    runId: runRecordWithBranch.id,
    status: "queued",
    tenantId: input.project.id,
    title: input.title,
  });

  try {
    const provisionResult = await provisionWorkspaceForRun({
      blueprint: input.blueprint,
      branchName,
      dispatchRecord: input.dispatchRecord,
      organizationId: input.organizationId,
      project: input.project,
      runId: runRecordWithBranch.id,
      runTitle: input.title,
    });

    await runtime.db
      .update(runs)
      .set({
        resultSummary: provisionResult.summary,
        startedAt: new Date(),
        status: provisionResult.status,
        updatedAt: new Date(),
        workspaceRecordId: provisionResult.workspace?.id ?? null,
      })
      .where(eq(runs.id, runRecordWithBranch.id));

    await runtime.db
      .update(organizationTenants)
      .set({
        lastRunAt: new Date(),
      })
      .where(eq(organizationTenants.id, input.project.id));

    if (provisionResult.workspace != null) {
      await recordRunLifecycleEvent({
        actorUserId: input.requestedByUserId,
        blueprintId: input.blueprint?.id ?? null,
        description:
          provisionResult.workspaceState?.status === "ready"
            ? `Run ${input.title} provisioned devbox ${provisionResult.workspace.workspaceId}.`
            : `Run ${input.title} is provisioning devbox ${provisionResult.workspace.workspaceId}.`,
        eventKind:
          provisionResult.workspaceState?.status === "ready"
            ? "run_workspace_ready"
            : "run_workspace_provisioning",
        message: provisionResult.summary,
        metadata: {
          branchName,
          workspaceId: provisionResult.workspace.workspaceId,
          workspaceStatus: provisionResult.workspaceState?.status ?? provisionResult.status,
        },
        organizationId: input.organizationId,
        runId: runRecordWithBranch.id,
        status: provisionResult.status,
        tenantId: input.project.id,
        title: input.title,
        workspaceRecordId: provisionResult.workspace.id,
      });
    } else {
      await recordRunLifecycleEvent({
        actorUserId: input.requestedByUserId,
        blueprintId: input.blueprint?.id ?? null,
        description: `Run ${input.title} is waiting for runtime prerequisites.`,
        eventKind: "run_queued_for_execution",
        message: provisionResult.summary,
        metadata: {
          branchName,
          workspaceStatus: provisionResult.status,
        },
        organizationId: input.organizationId,
        runId: runRecordWithBranch.id,
        status: provisionResult.status,
        tenantId: input.project.id,
        title: input.title,
      });
    }

    if (provisionResult.workspace != null) {
      await updateRunStepStatuses(runRecordWithBranch.id, [
        {
          details: "Isolated devbox provisioned for the run.",
          status: provisionResult.workspaceState?.status === "ready" ? "completed" : "in_progress",
          stepKey: "provision_devbox",
        },
        {
          details:
            provisionResult.workspaceState?.status === "ready"
              ? "Repository cloned into the devbox runtime."
              : "Repository clone is waiting for the devbox to finish provisioning.",
          status: provisionResult.workspaceState?.status === "ready" ? "completed" : "queued",
          stepKey: "clone_repository",
        },
      ]);
    }

    const responseRun = await buildRunDetailResponse(
      {
        ...runRecordWithBranch,
        resultSummary: provisionResult.summary,
        startedAt: new Date(),
        status: provisionResult.status,
        updatedAt: new Date(),
        workspaceRecordId: provisionResult.workspace?.id ?? null,
      },
      {
        reconcile: provisionResult.workspaceState?.status === "ready",
      },
    );

    if (runNeedsReconciliation(responseRun)) {
      requestActiveRunReconciliation();
    }

    return responseRun;
  } catch (error) {
    const failureMessage =
      error instanceof ProvisionerError ? error.message : "Run dispatch failed before execution.";

    await runtime.db
      .update(runs)
      .set({
        failureMessage,
        resultSummary: "Run failed before the execution bridge could complete provisioning.",
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runRecordWithBranch.id));

    await syncRunStepsForFailedRun(runRecordWithBranch.id, failureMessage);

    await recordRunLifecycleEvent({
      actorUserId: input.requestedByUserId,
      blueprintId: input.blueprint?.id ?? null,
      description: `Run ${input.title} failed before the execution bridge could provision a devbox.`,
      eventKind: "run_failed",
      level: "error",
      message: failureMessage,
      metadata: {
        branchName,
        failureStage: "provision_devbox",
      },
      organizationId: input.organizationId,
      runId: runRecordWithBranch.id,
      status: "failed",
      tenantId: input.project.id,
      title: input.title,
    });

    throw error;
  }
}

async function ensureDispatchSystemUser() {
  const systemEmail = "dispatch-bridge@firapps.local";
  const [existing] = await runtime.db
    .select()
    .from(users)
    .where(eq(users.email, systemEmail))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await runtime.db
    .insert(users)
    .values({
      email: systemEmail,
      emailVerified: true,
      name: "Dispatch Bridge",
    })
    .returning();

  return created;
}

function parseSlackDispatchText(text: string) {
  const parsed: Record<string, string> = {};

  for (const entry of text.split(/[;\n]/)) {
    const [rawKey, ...rawValue] = entry.split("=");

    if (!rawKey || rawValue.length === 0) {
      continue;
    }

    parsed[rawKey.trim().toLowerCase()] = rawValue.join("=").trim();
  }

  return parsed;
}

function readFormDataString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function toDispatchJsonValue(value: unknown): JsonValue {
  if (value == null) {
    return null;
  }

  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toDispatchJsonValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toDispatchJsonValue(entry)]),
    );
  }

  return Object.prototype.toString.call(value);
}

function toDispatchMetadata(value: unknown): DispatchMetadata {
  if (value == null) {
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toDispatchJsonValue(entry)]),
    );
  }

  return {
    value: toDispatchJsonValue(value),
  };
}

async function resolveProjectFromDispatch(input: {
  organizationSlug?: string;
  projectSlug: string;
}) {
  const records = await runtime.db
    .select({
      organizationSlug: organizations.slug,
      project: organizationTenants,
    })
    .from(organizationTenants)
    .innerJoin(organizations, eq(organizationTenants.organizationId, organizations.id))
    .where(eq(organizationTenants.slug, input.projectSlug));

  const matching = records.filter((record) =>
    input.organizationSlug ? record.organizationSlug === input.organizationSlug : true,
  );

  if (matching.length !== 1) {
    return null;
  }

  return matching[0] ?? null;
}

async function resolveBlueprintForDispatch(input: {
  blueprintSlug?: string;
  defaultBlueprintId?: string | null;
  organizationId: string;
}) {
  if (!input.blueprintSlug) {
    if (input.defaultBlueprintId) {
      const projectBlueprint = await getAccessibleBlueprintRecord(
        input.organizationId,
        input.defaultBlueprintId,
      );

      if (projectBlueprint) {
        return projectBlueprint;
      }
    }

    return getDefaultBlueprintRecord(input.organizationId);
  }

  const [record] = await runtime.db
    .select()
    .from(blueprints)
    .where(
      and(
        eq(blueprints.slug, input.blueprintSlug),
        eq(blueprints.isActive, true),
        or(eq(blueprints.organizationId, input.organizationId), isNull(blueprints.organizationId)),
      ),
    )
    .orderBy(desc(blueprints.organizationId))
    .limit(1);

  return record ?? null;
}

const listProjectsHandler = async (c: Context) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const records = await runtime.db
    .select({
      billingEmail: organizationTenants.billingEmail,
      billingPlan: organizationTenants.billingPlan,
      billingReference: organizationTenants.billingReference,
      billingStatus: organizationTenants.billingStatus,
      createdAt: organizationTenants.createdAt,
      defaultBlueprintId: organizationTenants.defaultBlueprintId,
      defaultBranch: organizationTenants.defaultBranch,
      description: organizationTenants.description,
      id: organizationTenants.id,
      lastRunAt: organizationTenants.lastRunAt,
      name: organizationTenants.name,
      repoName: organizationTenants.repoName,
      repoOwner: organizationTenants.repoOwner,
      repoProvider: organizationTenants.repoProvider,
      seatLimit: organizationTenants.seatLimit,
      slug: organizationTenants.slug,
      workflowMode: organizationTenants.workflowMode,
      workspaceCount: sql<number>`(
        select count(*)::int
        from ${organizationWorkspaces}
        where ${organizationWorkspaces.tenantId} = ${organizationTenants.id}
          and ${organizationWorkspaces.status} <> 'deleted'
      )`,
    })
    .from(organizationTenants)
    .where(eq(organizationTenants.organizationId, accessResult.access.organizationId))
    .orderBy(desc(organizationTenants.createdAt));

  const provisionerRuntime = await loadProvisionerRuntimeSnapshot();

  c.get("log").set({
    projects: { count: records.length },
  });

  return c.json({
    projects: records.map((record) => toProjectResponse(record, provisionerRuntime)),
  });
};

const createProjectHandler = async (c: Context) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const body = projectInputSchema.parse(await c.req.json());
  const defaultBlueprint = await ensureAccessibleBlueprintId(
    accessResult.access.organizationId,
    body.defaultBlueprintId,
  );

  if (body.defaultBlueprintId && !defaultBlueprint) {
    return c.json({ error: "default_blueprint_not_found" }, 404);
  }

  try {
    const validatedRepository = await validateProjectRepositorySettings({
      defaultBranch: body.defaultBranch,
      repoName: body.repoName,
      repoOwner: body.repoOwner,
      repoProvider: body.repoProvider,
    });
    const [project] = await runtime.db
      .insert(organizationTenants)
      .values({
        billingEmail: body.billingEmail ?? null,
        billingPlan: body.billingPlan ?? "growth",
        billingReference: body.billingReference ?? null,
        billingStatus: body.billingStatus ?? "active",
        defaultBlueprintId: defaultBlueprint?.id ?? null,
        defaultBranch: validatedRepository?.defaultBranch ?? body.defaultBranch,
        description: body.description ?? null,
        name: body.name,
        organizationId: accessResult.access.organizationId,
        repoName: validatedRepository?.repoName ?? body.repoName ?? null,
        repoOwner: validatedRepository?.repoOwner ?? body.repoOwner ?? null,
        repoProvider: validatedRepository != null ? "github" : (body.repoProvider ?? null),
        seatLimit: body.seatLimit ?? null,
        slug: body.slug,
        workflowMode: body.workflowMode,
      })
      .returning();

    await recordActivityEvent({
      actorUserId: accessResult.access.session.user.id,
      blueprintId: project.defaultBlueprintId,
      description: `Project ${project.name} was created for ${project.slug}.`,
      kind: "project_created",
      organizationId: accessResult.access.organizationId,
      status: "completed",
      tenantId: project.id,
      title: project.name,
    });

    return c.json(
      {
        project: toProjectResponse(project, await loadProvisionerRuntimeSnapshot()),
      },
      201,
    );
  } catch (error) {
    if (error instanceof GitHubIntegrationError) {
      return buildGitHubErrorResponse(c, error);
    }

    if (isUniqueViolation(error)) {
      return c.json({ error: "project_slug_conflict" }, 409);
    }

    throw error;
  }
};

const updateProjectHandler = async (c: Context) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = projectIdParamsSchema.parse({
    projectId: c.req.param("projectId"),
  });
  const project = await getOrganizationTenantRecord(
    accessResult.access.organizationId,
    params.projectId,
  );

  if (!project) {
    return c.json({ error: "project_not_found" }, 404);
  }

  const patch = projectPatchSchema.parse(await c.req.json());
  const defaultBlueprintId =
    patch.defaultBlueprintId === undefined ? project.defaultBlueprintId : patch.defaultBlueprintId;
  const defaultBlueprint = await ensureAccessibleBlueprintId(
    accessResult.access.organizationId,
    defaultBlueprintId,
  );

  if (defaultBlueprintId && !defaultBlueprint) {
    return c.json({ error: "default_blueprint_not_found" }, 404);
  }

  const mergedProject = projectInputSchema.parse({
    billingEmail: patch.billingEmail !== undefined ? patch.billingEmail : project.billingEmail,
    billingPlan: patch.billingPlan !== undefined ? patch.billingPlan : project.billingPlan,
    billingReference:
      patch.billingReference !== undefined ? patch.billingReference : project.billingReference,
    billingStatus: patch.billingStatus !== undefined ? patch.billingStatus : project.billingStatus,
    defaultBlueprintId,
    defaultBranch: patch.defaultBranch !== undefined ? patch.defaultBranch : project.defaultBranch,
    description: patch.description !== undefined ? patch.description : project.description,
    name: patch.name !== undefined ? patch.name : project.name,
    repoName: patch.repoName !== undefined ? patch.repoName : project.repoName,
    repoOwner: patch.repoOwner !== undefined ? patch.repoOwner : project.repoOwner,
    repoProvider: patch.repoProvider !== undefined ? patch.repoProvider : project.repoProvider,
    seatLimit: patch.seatLimit !== undefined ? patch.seatLimit : project.seatLimit,
    slug: patch.slug !== undefined ? patch.slug : project.slug,
    workflowMode: patch.workflowMode !== undefined ? patch.workflowMode : project.workflowMode,
  });

  try {
    const repoRegistrationChanged =
      patch.defaultBranch !== undefined ||
      patch.repoName !== undefined ||
      patch.repoOwner !== undefined ||
      patch.repoProvider !== undefined;
    const validatedRepository = repoRegistrationChanged
      ? await validateProjectRepositorySettings({
          defaultBranch: mergedProject.defaultBranch,
          repoName: mergedProject.repoName,
          repoOwner: mergedProject.repoOwner,
          repoProvider: mergedProject.repoProvider,
        })
      : null;
    const [updatedProject] = await runtime.db
      .update(organizationTenants)
      .set(
        pickDefined({
          billingEmail:
            patch.billingEmail !== undefined ? (mergedProject.billingEmail ?? null) : undefined,
          billingPlan:
            patch.billingPlan !== undefined ? (mergedProject.billingPlan ?? "growth") : undefined,
          billingReference:
            patch.billingReference !== undefined
              ? (mergedProject.billingReference ?? null)
              : undefined,
          billingStatus:
            patch.billingStatus !== undefined
              ? (mergedProject.billingStatus ?? "active")
              : undefined,
          defaultBlueprintId:
            patch.defaultBlueprintId !== undefined ? (defaultBlueprint?.id ?? null) : undefined,
          defaultBranch:
            patch.defaultBranch !== undefined
              ? (validatedRepository?.defaultBranch ?? mergedProject.defaultBranch)
              : undefined,
          description:
            patch.description !== undefined ? (mergedProject.description ?? null) : undefined,
          name: patch.name !== undefined ? mergedProject.name : undefined,
          repoName:
            patch.repoName !== undefined
              ? (validatedRepository?.repoName ?? mergedProject.repoName ?? null)
              : undefined,
          repoOwner:
            patch.repoOwner !== undefined
              ? (validatedRepository?.repoOwner ?? mergedProject.repoOwner ?? null)
              : undefined,
          repoProvider:
            patch.repoProvider !== undefined
              ? validatedRepository != null
                ? "github"
                : (mergedProject.repoProvider ?? null)
              : undefined,
          seatLimit: patch.seatLimit !== undefined ? (mergedProject.seatLimit ?? null) : undefined,
          slug: patch.slug !== undefined ? mergedProject.slug : undefined,
          workflowMode: patch.workflowMode !== undefined ? mergedProject.workflowMode : undefined,
        }),
      )
      .where(eq(organizationTenants.id, project.id))
      .returning();

    await recordActivityEvent({
      actorUserId: accessResult.access.session.user.id,
      blueprintId: updatedProject.defaultBlueprintId,
      description: `Project ${updatedProject.name} was updated.`,
      kind: "project_updated",
      organizationId: accessResult.access.organizationId,
      status: "completed",
      tenantId: updatedProject.id,
      title: updatedProject.name,
    });

    return c.json({
      project: toProjectResponse(updatedProject, await loadProvisionerRuntimeSnapshot()),
    });
  } catch (error) {
    if (error instanceof GitHubIntegrationError) {
      return buildGitHubErrorResponse(c, error);
    }

    if (isUniqueViolation(error)) {
      return c.json({ error: "project_slug_conflict" }, 409);
    }

    throw error;
  }
};

const deleteProjectHandler = async (c: Context) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = projectIdParamsSchema.parse({
    projectId: c.req.param("projectId"),
  });
  const project = await getOrganizationTenantRecord(
    accessResult.access.organizationId,
    params.projectId,
  );

  if (!project) {
    return c.json({ error: "project_not_found" }, 404);
  }

  const workspaceRecords = await runtime.db
    .select()
    .from(organizationWorkspaces)
    .where(eq(organizationWorkspaces.tenantId, project.id));

  for (const workspace of workspaceRecords) {
    try {
      await deleteProvisionerWorkspace(workspace.workspaceId);
    } catch (error) {
      if (!(error instanceof ProvisionerError && error.status === 404)) {
        return buildProvisionerErrorResponse(c, error);
      }
    }
  }

  await runtime.db.delete(organizationTenants).where(eq(organizationTenants.id, project.id));

  await recordActivityEvent({
    actorUserId: accessResult.access.session.user.id,
    blueprintId: project.defaultBlueprintId,
    description: `Project ${project.name} was deleted.`,
    kind: "project_deleted",
    organizationId: accessResult.access.organizationId,
    status: "completed",
    tenantId: project.id,
    title: project.name,
  });

  return c.json({ ok: true });
};

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

app.get(`${internalApiEnv.API_PREFIX}/organization-tenants`, listProjectsHandler);
app.get(`${internalApiEnv.API_PREFIX}/projects`, listProjectsHandler);
app.post(`${internalApiEnv.API_PREFIX}/organization-tenants`, createProjectHandler);
app.post(`${internalApiEnv.API_PREFIX}/projects`, createProjectHandler);
app.patch(`${internalApiEnv.API_PREFIX}/projects/:projectId`, updateProjectHandler);
app.delete(`${internalApiEnv.API_PREFIX}/projects/:projectId`, deleteProjectHandler);

app.get(`${internalApiEnv.API_PREFIX}/runners`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const records = await runtime.db
    .select()
    .from(runnerRegistrations)
    .where(eq(runnerRegistrations.organizationId, accessResult.access.organizationId))
    .orderBy(desc(runnerRegistrations.createdAt));

  return c.json({
    runners: records.map(toRunnerRegistrationResponse),
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runners`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const body = createRunnerRegistrationSchema.parse(await c.req.json());

  if (body.tenantId) {
    const project = await getOrganizationTenantRecord(
      accessResult.access.organizationId,
      body.tenantId,
    );

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }
  }

  const apiKey = createRunnerApiKey();
  const [runner] = await runtime.db
    .insert(runnerRegistrations)
    .values({
      allowedOperations: body.allowedOperations ?? [...runnerOperations],
      apiKeyExpiresAt: body.apiKeyExpiresAt ? new Date(body.apiKeyExpiresAt) : null,
      apiKeyHash: hashRunnerSecret(apiKey),
      apiKeyPreview: buildRunnerSecretPreview(apiKey),
      capabilityScopes: toRunnerMetadata(body.capabilityScopes),
      createdByUserId: accessResult.access.session.user.id,
      displayName: body.displayName,
      maxConcurrency: body.maxConcurrency,
      organizationId: accessResult.access.organizationId,
      repositoryScopes: toRunnerMetadata(body.repositoryScopes),
      tenantId: body.tenantId ?? null,
    })
    .returning();

  await recordActivityEvent({
    actorUserId: accessResult.access.session.user.id,
    description: `Runner ${runner.displayName} was registered.`,
    kind: "runner_registered",
    metadata: {
      maxConcurrency: runner.maxConcurrency,
      operationCount: runner.allowedOperations.length,
      tenantId: runner.tenantId,
    },
    organizationId: accessResult.access.organizationId,
    status: "completed",
    tenantId: runner.tenantId,
    title: runner.displayName,
  });

  return c.json(
    {
      apiKey,
      runner: toRunnerRegistrationResponse(runner),
    },
    201,
  );
});

app.post(`${internalApiEnv.API_PREFIX}/runners/session`, async (c) => {
  const body = createRunnerSessionSchema.parse(await c.req.json());
  const apiKey = readBearerToken(c);

  if (!apiKey) {
    return c.json({ error: "runner_api_key_required" }, 401);
  }

  const now = new Date();
  const apiKeyHash = hashRunnerSecret(apiKey);
  const [runner] = await runtime.db
    .select()
    .from(runnerRegistrations)
    .where(
      and(
        eq(runnerRegistrations.apiKeyHash, apiKeyHash),
        or(eq(runnerRegistrations.status, "active"), eq(runnerRegistrations.status, "online")),
        isNull(runnerRegistrations.revokedAt),
        or(
          isNull(runnerRegistrations.apiKeyExpiresAt),
          gt(runnerRegistrations.apiKeyExpiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (!runner) {
    return c.json({ error: "runner_api_key_invalid" }, 401);
  }

  const sessionToken = createRunnerSessionToken();
  const expiresAt = nextRunnerSessionExpiry(now);
  const [session] = await runtime.db
    .insert(runnerSessions)
    .values({
      expiresAt,
      hostCapabilities: toRunnerMetadata(body.hostCapabilities),
      imageDigest: body.imageDigest ?? null,
      protocolVersion: body.protocolVersion,
      runnerId: runner.id,
      runnerVersion: body.runnerVersion ?? null,
      tokenHash: hashRunnerSecret(sessionToken),
    })
    .returning();

  const [updatedRunner] = await runtime.db
    .update(runnerRegistrations)
    .set({
      imageDigest: body.imageDigest ?? runner.imageDigest,
      lastHeartbeatAt: now,
      protocolVersion: body.protocolVersion,
      runnerVersion: body.runnerVersion ?? runner.runnerVersion,
      status: "online",
      updatedAt: now,
    })
    .where(eq(runnerRegistrations.id, runner.id))
    .returning();

  return c.json({
    expiresAt,
    runner: toRunnerRegistrationResponse(updatedRunner),
    runnerId: updatedRunner.id,
    session: {
      expiresAt: session.expiresAt,
      id: session.id,
      protocolVersion: session.protocolVersion,
    },
    sessionToken,
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runners/:runnerId/revoke`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = runnerIdParamsSchema.parse({
    runnerId: c.req.param("runnerId"),
  });
  const runner = await getOrganizationRunnerRecord(
    accessResult.access.organizationId,
    params.runnerId,
  );

  if (!runner) {
    return c.json({ error: "runner_not_found" }, 404);
  }

  const now = new Date();
  const [updatedRunner] = await runtime.db
    .update(runnerRegistrations)
    .set({
      revokedAt: now,
      status: "revoked",
      updatedAt: now,
    })
    .where(eq(runnerRegistrations.id, runner.id))
    .returning();

  await runtime.db
    .update(runnerSessions)
    .set({
      revokedAt: now,
    })
    .where(eq(runnerSessions.runnerId, runner.id));

  await recordActivityEvent({
    actorUserId: accessResult.access.session.user.id,
    description: `Runner ${runner.displayName} was revoked.`,
    kind: "runner_revoked",
    organizationId: accessResult.access.organizationId,
    status: "revoked",
    tenantId: runner.tenantId,
    title: runner.displayName,
  });

  return c.json({
    runner: toRunnerRegistrationResponse(updatedRunner),
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runners/:runnerId/heartbeat`, async (c) => {
  const params = runnerIdParamsSchema.parse({
    runnerId: c.req.param("runnerId"),
  });
  const authResult = await requireRunnerSession(c, params.runnerId);

  if (authResult.response) {
    return authResult.response;
  }

  const body = runnerHeartbeatSchema.parse(await c.req.json());
  const now = new Date();
  await runtime.db
    .update(runnerSessions)
    .set({
      cleanupState: body.cleanupState ?? authResult.session.cleanupState,
      currentConcurrency: body.currentConcurrency,
      hostCapabilities: toRunnerMetadata(body.hostCapabilities),
      imageDigest: body.imageDigest ?? authResult.session.imageDigest,
      lastSeenAt: now,
      runnerVersion: body.runnerVersion ?? authResult.session.runnerVersion,
    })
    .where(eq(runnerSessions.id, authResult.session.id));

  const [runner] = await runtime.db
    .update(runnerRegistrations)
    .set({
      imageDigest: body.imageDigest ?? authResult.runner.imageDigest,
      lastHeartbeatAt: now,
      protocolVersion: body.protocolVersion,
      runnerVersion: body.runnerVersion ?? authResult.runner.runnerVersion,
      status: "online",
      updatedAt: now,
    })
    .where(eq(runnerRegistrations.id, authResult.runner.id))
    .returning();

  return c.json({
    runner: toRunnerRegistrationResponse(runner),
    session: {
      expiresAt: authResult.session.expiresAt,
      id: authResult.session.id,
    },
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runner-jobs`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const body = createRunnerJobSchema.parse(await c.req.json());
  const scope = await assertRunnerJobScope({
    operation: body.operation,
    organizationId: accessResult.access.organizationId,
    runnerId: body.runnerId,
    tenantId: body.tenantId,
  });

  if ("error" in scope) {
    return c.json({ error: scope.error }, scope.status);
  }

  try {
    const [job] = await runtime.db
      .insert(runnerJobs)
      .values({
        idempotencyKey: body.idempotencyKey ?? randomUUID(),
        operation: body.operation,
        organizationId: accessResult.access.organizationId,
        params: toRunnerMetadata(body.params),
        requestedByUserId: accessResult.access.session.user.id,
        runId: body.runId ?? null,
        runnerId: body.runnerId ?? null,
        tenantId: scope.project.id,
      })
      .returning();

    await recordActivityEvent({
      actorUserId: accessResult.access.session.user.id,
      description: `Runner job ${job.operation} was queued for ${scope.project.name}.`,
      kind: "runner_job_queued",
      metadata: {
        jobId: job.id,
        operation: job.operation,
        runnerId: job.runnerId,
      },
      organizationId: accessResult.access.organizationId,
      runId: job.runId,
      status: "queued",
      tenantId: scope.project.id,
      title: job.operation,
    });

    return c.json({ job: toRunnerJobResponse(job) }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ error: "runner_job_idempotency_conflict" }, 409);
    }

    throw error;
  }
});

app.post(`${internalApiEnv.API_PREFIX}/runners/:runnerId/jobs/claim`, async (c) => {
  const params = runnerIdParamsSchema.parse({
    runnerId: c.req.param("runnerId"),
  });
  const authResult = await requireRunnerSession(c, params.runnerId);

  if (authResult.response) {
    return authResult.response;
  }

  const body = claimRunnerJobSchema.parse(await c.req.json());
  const supportedOperations = body.supportedOperations ?? [...runnerOperations];
  const allowedOperations = authResult.runner.allowedOperations.filter((operation) =>
    supportedOperations.includes(operation),
  );
  const remainingCapacity = Math.max(0, authResult.runner.maxConcurrency - body.currentConcurrency);
  const claimCapacity = Math.min(body.capacity, remainingCapacity);

  if (claimCapacity < 1 || allowedOperations.length === 0) {
    return c.json({
      job: null,
      leaseSeconds: defaultRunnerLeaseSeconds,
      protocolVersion: runnerProtocolVersion,
    });
  }

  const filters = [
    eq(runnerJobs.organizationId, authResult.runner.organizationId),
    eq(runnerJobs.status, "queued"),
    inArray(runnerJobs.operation, allowedOperations),
    or(isNull(runnerJobs.runnerId), eq(runnerJobs.runnerId, authResult.runner.id)),
  ];

  if (authResult.runner.tenantId != null) {
    filters.push(eq(runnerJobs.tenantId, authResult.runner.tenantId));
  }

  const [candidate] = await runtime.db
    .select()
    .from(runnerJobs)
    .where(and(...filters))
    .orderBy(runnerJobs.createdAt)
    .limit(1);

  if (!candidate) {
    return c.json({
      job: null,
      leaseSeconds: defaultRunnerLeaseSeconds,
      protocolVersion: runnerProtocolVersion,
    });
  }

  const leaseExpiresAt = nextRunnerLeaseExpiry(defaultRunnerLeaseSeconds);
  const [job] = await runtime.db
    .update(runnerJobs)
    .set({
      leaseExpiresAt,
      runnerId: authResult.runner.id,
      sessionId: authResult.session.id,
      status: "leased",
      updatedAt: new Date(),
    })
    .where(and(eq(runnerJobs.id, candidate.id), eq(runnerJobs.status, "queued")))
    .returning();

  if (!job) {
    return c.json({
      job: null,
      leaseSeconds: defaultRunnerLeaseSeconds,
      protocolVersion: runnerProtocolVersion,
    });
  }

  await runtime.db.insert(runnerJobEvents).values({
    eventKind: "claimed",
    jobId: job.id,
    message: `Runner ${authResult.runner.displayName} claimed ${job.operation}.`,
    metadata: {
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      runnerSessionId: authResult.session.id,
    },
    runnerId: authResult.runner.id,
  });

  return c.json({
    job: toRunnerJobResponse(job),
    leaseExpiresAt,
    protocolVersion: runnerProtocolVersion,
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runner-jobs/:jobId/lease`, async (c) => {
  const authResult = await requireRunnerSession(c);

  if (authResult.response) {
    return authResult.response;
  }

  const params = runnerJobIdParamsSchema.parse({
    jobId: c.req.param("jobId"),
  });
  const body = updateRunnerLeaseSchema.parse(await c.req.json());
  const job = await getRunnerOwnedJob({
    jobId: params.jobId,
    runnerId: authResult.runner.id,
  });

  if (!job) {
    return c.json({ error: "runner_job_not_found" }, 404);
  }

  if (body.action === "cancel") {
    const [cancelledJob] = await runtime.db
      .update(runnerJobs)
      .set({
        completedAt: new Date(),
        leaseExpiresAt: null,
        sessionId: authResult.session.id,
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(runnerJobs.id, job.id))
      .returning();

    await runtime.db.insert(runnerJobEvents).values({
      eventKind: "cancelled",
      jobId: job.id,
      level: "warn",
      message: "Runner cancelled the leased job.",
      runnerId: authResult.runner.id,
    });

    return c.json({ job: toRunnerJobResponse(cancelledJob) });
  }

  if (!["leased", "running"].includes(job.status)) {
    return c.json({ error: "runner_job_not_leased" }, 409);
  }

  const leaseExpiresAt = nextRunnerLeaseExpiry(body.leaseSeconds);
  const [updatedJob] = await runtime.db
    .update(runnerJobs)
    .set({
      leaseExpiresAt,
      sessionId: authResult.session.id,
      status: job.status === "leased" ? "running" : job.status,
      updatedAt: new Date(),
    })
    .where(eq(runnerJobs.id, job.id))
    .returning();

  await runtime.db.insert(runnerJobEvents).values({
    eventKind: "lease_extended",
    jobId: job.id,
    message: "Runner extended the job lease.",
    metadata: {
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    },
    runnerId: authResult.runner.id,
  });

  return c.json({
    job: toRunnerJobResponse(updatedJob),
    leaseExpiresAt,
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runner-jobs/:jobId/events`, async (c) => {
  const authResult = await requireRunnerSession(c);

  if (authResult.response) {
    return authResult.response;
  }

  const params = runnerJobIdParamsSchema.parse({
    jobId: c.req.param("jobId"),
  });
  const body = runnerJobEventSchema.parse(await c.req.json());
  const job = await getRunnerOwnedJob({
    jobId: params.jobId,
    runnerId: authResult.runner.id,
  });

  if (!job) {
    return c.json({ error: "runner_job_not_found" }, 404);
  }

  if (body.eventKind === "started" && job.status === "leased") {
    await runtime.db
      .update(runnerJobs)
      .set({
        sessionId: authResult.session.id,
        status: "running",
        updatedAt: new Date(),
      })
      .where(eq(runnerJobs.id, job.id));
  }

  const [event] = await runtime.db
    .insert(runnerJobEvents)
    .values({
      eventKind: body.eventKind,
      jobId: job.id,
      level: body.level,
      message: body.message,
      metadata: toRunnerMetadata(body.metadata),
      runnerId: authResult.runner.id,
    })
    .returning();

  return c.json({ event }, 201);
});

app.post(`${internalApiEnv.API_PREFIX}/runner-jobs/:jobId/complete`, async (c) => {
  const authResult = await requireRunnerSession(c);

  if (authResult.response) {
    return authResult.response;
  }

  const params = runnerJobIdParamsSchema.parse({
    jobId: c.req.param("jobId"),
  });
  const body = completeRunnerJobSchema.parse(await c.req.json());
  const job = await getRunnerOwnedJob({
    jobId: params.jobId,
    runnerId: authResult.runner.id,
  });

  if (!job) {
    return c.json({ error: "runner_job_not_found" }, 404);
  }

  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return c.json({ error: "runner_job_already_terminal" }, 409);
  }

  const [updatedJob] = await runtime.db
    .update(runnerJobs)
    .set({
      completedAt: new Date(),
      failureMessage: body.failureMessage ?? null,
      leaseExpiresAt: null,
      result: toRunnerMetadata(body.result),
      sessionId: authResult.session.id,
      status: body.status,
      updatedAt: new Date(),
    })
    .where(eq(runnerJobs.id, job.id))
    .returning();

  await runtime.db.insert(runnerJobEvents).values({
    eventKind: body.status,
    jobId: job.id,
    level: body.status === "completed" ? "info" : "error",
    message: body.failureMessage ?? `Runner job ${body.status}.`,
    metadata: toRunnerMetadata(body.result),
    runnerId: authResult.runner.id,
  });

  return c.json({
    job: toRunnerJobResponse(updatedJob),
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runner-jobs/:jobId/artifacts`, async (c) => {
  const authResult = await requireRunnerSession(c);

  if (authResult.response) {
    return authResult.response;
  }

  const params = runnerJobIdParamsSchema.parse({
    jobId: c.req.param("jobId"),
  });
  const body = uploadRunnerArtifactsSchema.parse(await c.req.json());
  const job = await getRunnerOwnedJob({
    jobId: params.jobId,
    runnerId: authResult.runner.id,
  });

  if (!job) {
    return c.json({ error: "runner_job_not_found" }, 404);
  }

  const artifacts = await runtime.db
    .insert(runnerJobArtifacts)
    .values(
      body.artifacts.map((artifact) => ({
        artifactType: artifact.artifactType,
        jobId: job.id,
        label: artifact.label,
        metadata: toRunnerMetadata(artifact.metadata),
        url: artifact.url ?? null,
        value: artifact.value ?? null,
      })),
    )
    .returning();

  await runtime.db.insert(runnerJobEvents).values({
    eventKind: "artifacts_uploaded",
    jobId: job.id,
    message: `Runner uploaded ${artifacts.length} artifact(s).`,
    metadata: {
      count: artifacts.length,
    },
    runnerId: authResult.runner.id,
  });

  return c.json({ artifacts }, 201);
});

app.get(`${internalApiEnv.API_PREFIX}/overview`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const organizationId = accessResult.access.organizationId;

  const [projectRows, workspaceRows, runRows, invitationRows] = await Promise.all([
    runtime.db
      .select({ id: organizationTenants.id })
      .from(organizationTenants)
      .where(eq(organizationTenants.organizationId, organizationId)),
    runtime.db
      .select({ id: organizationWorkspaces.id, status: organizationWorkspaces.status })
      .from(organizationWorkspaces)
      .innerJoin(organizationTenants, eq(organizationWorkspaces.tenantId, organizationTenants.id))
      .where(
        and(
          eq(organizationTenants.organizationId, organizationId),
          sql`${organizationWorkspaces.status} <> 'deleted'`,
        ),
      ),
    runtime.db
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(eq(runs.organizationId, organizationId)),
    runtime.db
      .select({ id: organizationInvitations.id, status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.organizationId, organizationId)),
  ]);

  const readyWorkspaces = workspaceRows.filter((workspace) => workspace.status === "ready").length;
  const activeRuns = runRows.filter((runRecord) =>
    ["queued", "provisioning", "workspace_ready"].includes(runRecord.status),
  ).length;
  const failedRuns = runRows.filter((runRecord) => runRecord.status === "failed").length;
  const pendingInvitations = invitationRows.filter(
    (invitation) => invitation.status === "pending",
  ).length;

  return c.json({
    overview: {
      activeRuns,
      failedRuns,
      pendingInvitations,
      projectCount: projectRows.length,
      readyWorkspaces,
      runCount: runRows.length,
      workspaceCount: workspaceRows.length,
    },
  });
});

app.get(`${internalApiEnv.API_PREFIX}/queue`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  return c.json(
    await buildQueueSnapshot({
      organizationId: accessResult.access.organizationId,
    }),
  );
});

app.get(`${internalApiEnv.API_PREFIX}/queue/metrics`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  return c.json(
    await buildQueueMetricsSnapshot({
      organizationId: accessResult.access.organizationId,
    }),
  );
});

app.get(`${internalApiEnv.API_PREFIX}/electric/queue/runs`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, { requireAdmin: true });

  if (accessResult.response) {
    return accessResult.response;
  }

  return proxyElectricShape(c, {
    columns: [
      "id",
      "organization_id",
      "tenant_id",
      "blueprint_id",
      "requested_by_user_id",
      "workspace_record_id",
      "source",
      "title",
      "objective",
      "status",
      "branch_name",
      "pr_url",
      "result_summary",
      "failure_message",
      "queued_at",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at",
    ],
    params: {
      1: accessResult.access.organizationId,
    },
    replica: "full",
    table: "operations.runs",
    where: "organization_id = $1",
  });
});

app.get(`${internalApiEnv.API_PREFIX}/electric/queue/dispatches`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, { requireAdmin: true });

  if (accessResult.response) {
    return accessResult.response;
  }

  return proxyElectricShape(c, {
    columns: [
      "id",
      "organization_id",
      "tenant_id",
      "blueprint_id",
      "run_id",
      "source",
      "requested_by_name",
      "requested_by_email",
      "created_at",
      "updated_at",
    ],
    params: {
      1: accessResult.access.organizationId,
    },
    replica: "full",
    table: "operations.dispatches",
    where: "organization_id = $1",
  });
});

app.get(`${internalApiEnv.API_PREFIX}/electric/queue/projects`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, { requireAdmin: true });

  if (accessResult.response) {
    return accessResult.response;
  }

  return proxyElectricShape(c, {
    columns: ["id", "organization_id", "name", "slug"],
    params: {
      1: accessResult.access.organizationId,
    },
    replica: "full",
    table: "operations.organization_tenants",
    where: "organization_id = $1",
  });
});

app.get(`${internalApiEnv.API_PREFIX}/electric/queue/blueprints`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, { requireAdmin: true });

  if (accessResult.response) {
    return accessResult.response;
  }

  return proxyElectricShape(c, {
    columns: ["id", "organization_id", "name"],
    params: {
      1: accessResult.access.organizationId,
    },
    replica: "full",
    table: "operations.blueprints",
    where: "organization_id = $1 or organization_id is null",
  });
});

app.get(`${internalApiEnv.API_PREFIX}/electric/queue/workspaces`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, { requireAdmin: true });

  if (accessResult.response) {
    return accessResult.response;
  }

  const projectRows = await runtime.db
    .select({ id: organizationTenants.id })
    .from(organizationTenants)
    .where(eq(organizationTenants.organizationId, accessResult.access.organizationId));
  const projectIdFilter = buildElectricUuidInFilter(
    "tenant_id",
    projectRows.map((project) => project.id),
  );

  return proxyElectricShape(c, {
    columns: [
      "id",
      "tenant_id",
      "workspace_id",
      "provider",
      "repo_provider",
      "repo_owner",
      "repo_name",
      "image_flavor",
      "nix_packages",
      "status",
      "ide_url",
      "preview_url",
      "created_at",
      "updated_at",
    ],
    params: projectIdFilter.params,
    replica: "full",
    table: "operations.organization_workspaces",
    where: `status <> 'deleted' and ${projectIdFilter.where}`,
  });
});

app.get(`${internalApiEnv.API_PREFIX}/electric/queue/run-steps`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, { requireAdmin: true });

  if (accessResult.response) {
    return accessResult.response;
  }

  const runRows = await runtime.db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.organizationId, accessResult.access.organizationId));
  const runIdFilter = buildElectricUuidInFilter(
    "run_id",
    runRows.map((runRecord) => runRecord.id),
  );

  return proxyElectricShape(c, {
    columns: ["id", "run_id", "status"],
    params: runIdFilter.params,
    replica: "full",
    table: "operations.run_steps",
    where: runIdFilter.where,
  });
});

app.get(`${internalApiEnv.API_PREFIX}/electric/queue/activity`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, { requireAdmin: true });

  if (accessResult.response) {
    return accessResult.response;
  }

  return proxyElectricShape(c, {
    columns: ["id", "organization_id", "kind", "title", "description", "status", "occurred_at"],
    params: {
      1: accessResult.access.organizationId,
    },
    replica: "full",
    table: "operations.activity_events",
    where: "organization_id = $1",
  });
});

app.get(`${internalApiEnv.API_PREFIX}/blueprints`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const records = await runtime.db
    .select()
    .from(blueprints)
    .where(
      and(
        eq(blueprints.isActive, true),
        or(
          eq(blueprints.organizationId, accessResult.access.organizationId),
          isNull(blueprints.organizationId),
        ),
      ),
    )
    .orderBy(desc(blueprints.organizationId), blueprints.slug);

  return c.json({ blueprints: records });
});

app.post(`${internalApiEnv.API_PREFIX}/blueprints`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const body = createBlueprintSchema.parse(await c.req.json());
  const [existingBlueprint] = await runtime.db
    .select({ id: blueprints.id })
    .from(blueprints)
    .where(
      and(
        eq(blueprints.slug, body.slug),
        eq(blueprints.organizationId, accessResult.access.organizationId),
      ),
    )
    .limit(1);

  if (existingBlueprint) {
    return c.json({ error: "blueprint_slug_conflict" }, 409);
  }

  const [blueprint] = await runtime.db
    .insert(blueprints)
    .values({
      description: body.description,
      name: body.name,
      organizationId: accessResult.access.organizationId,
      scope: "organization",
      slug: body.slug,
      steps: body.steps,
      triggerSource: body.triggerSource,
    })
    .returning();

  await recordActivityEvent({
    actorUserId: accessResult.access.session.user.id,
    blueprintId: blueprint.id,
    description: `Blueprint ${blueprint.name} was created.`,
    kind: "blueprint_created",
    organizationId: accessResult.access.organizationId,
    status: "completed",
    title: blueprint.name,
  });

  return c.json({ blueprint }, 201);
});

app.patch(`${internalApiEnv.API_PREFIX}/blueprints/:blueprintId`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = blueprintIdParamsSchema.parse({
    blueprintId: c.req.param("blueprintId"),
  });
  const existingBlueprint = await getOwnedBlueprintRecord(
    accessResult.access.organizationId,
    params.blueprintId,
  );

  if (!existingBlueprint) {
    return c.json({ error: "blueprint_not_found" }, 404);
  }

  const patch = updateBlueprintSchema.parse(await c.req.json());

  try {
    const [blueprint] = await runtime.db
      .update(blueprints)
      .set(
        pickDefined({
          description: patch.description,
          isActive: patch.isActive,
          name: patch.name,
          slug: patch.slug,
          steps: patch.steps,
          triggerSource: patch.triggerSource,
          updatedAt: new Date(),
        }),
      )
      .where(eq(blueprints.id, existingBlueprint.id))
      .returning();

    await recordActivityEvent({
      actorUserId: accessResult.access.session.user.id,
      blueprintId: blueprint.id,
      description: `Blueprint ${blueprint.name} was updated.`,
      kind: "blueprint_updated",
      organizationId: accessResult.access.organizationId,
      status: blueprint.isActive ? "completed" : "archived",
      title: blueprint.name,
    });

    return c.json({ blueprint });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ error: "blueprint_slug_conflict" }, 409);
    }

    throw error;
  }
});

app.delete(`${internalApiEnv.API_PREFIX}/blueprints/:blueprintId`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = blueprintIdParamsSchema.parse({
    blueprintId: c.req.param("blueprintId"),
  });
  const existingBlueprint = await getOwnedBlueprintRecord(
    accessResult.access.organizationId,
    params.blueprintId,
  );

  if (!existingBlueprint) {
    return c.json({ error: "blueprint_not_found" }, 404);
  }

  await runtime.db
    .update(organizationTenants)
    .set({
      defaultBlueprintId: null,
    })
    .where(
      and(
        eq(organizationTenants.organizationId, accessResult.access.organizationId),
        eq(organizationTenants.defaultBlueprintId, existingBlueprint.id),
      ),
    );

  const [blueprint] = await runtime.db
    .update(blueprints)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(blueprints.id, existingBlueprint.id))
    .returning();

  await recordActivityEvent({
    actorUserId: accessResult.access.session.user.id,
    blueprintId: blueprint.id,
    description: `Blueprint ${blueprint.name} was archived.`,
    kind: "blueprint_archived",
    organizationId: accessResult.access.organizationId,
    status: "archived",
    title: blueprint.name,
  });

  return c.json({ ok: true });
});

app.get(`${internalApiEnv.API_PREFIX}/workspaces`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const query = workspaceQuerySchema.parse({
    tenantId: c.req.query("tenantId"),
  });
  const tenant = await getOrganizationTenantRecord(
    accessResult.access.organizationId,
    query.tenantId,
  );

  if (!tenant) {
    return c.json({ error: "organization_tenant_not_found" }, 404);
  }

  const records = await runtime.db
    .select()
    .from(organizationWorkspaces)
    .where(
      and(
        eq(organizationWorkspaces.tenantId, tenant.id),
        sql`${organizationWorkspaces.status} <> 'deleted'`,
      ),
    )
    .orderBy(desc(organizationWorkspaces.createdAt));

  if (records.length === 0) {
    c.get("log").set({
      workspaces: { count: 0 },
    });

    return c.json({ workspaces: [] });
  }

  try {
    const runtimeStates = await listProvisionerWorkspaces({
      tenantId: tenant.id,
      workspaceIds: records.map((record) => record.workspaceId),
    });
    const runtimeStateById = new Map(
      runtimeStates.map((runtimeState) => [runtimeState.workspaceId, runtimeState]),
    );

    await syncWorkspaceCache(records, runtimeStates);

    c.get("log").set({
      workspaces: { count: records.length },
    });

    return c.json({
      workspaces: records.map((record) =>
        mergeWorkspaceRecord(record, runtimeStateById.get(record.workspaceId)),
      ),
    });
  } catch (error) {
    return buildProvisionerErrorResponse(c, error);
  }
});

app.post(`${internalApiEnv.API_PREFIX}/workspaces`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const body = createWorkspaceSchema.parse(await c.req.json());
  const tenant = await getOrganizationTenantRecord(
    accessResult.access.organizationId,
    body.tenantId,
  );

  if (!tenant) {
    return c.json({ error: "organization_tenant_not_found" }, 404);
  }

  let runtimeState: ProvisionerWorkspace;

  try {
    runtimeState = await createProvisionerWorkspace({
      imageFlavor: body.imageFlavor,
      nixPackages: body.nixPackages,
      organizationId: accessResult.access.organizationId,
      provider: body.provider,
      projectId: tenant.id,
      projectName: tenant.name,
      projectSlug: tenant.slug,
      repoName: body.repoName,
      repoOwner: body.repoOwner,
      repoProvider: body.repoProvider,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      workspaceId: buildWorkspaceId(tenant.slug),
    });
  } catch (error) {
    return buildProvisionerErrorResponse(c, error);
  }

  try {
    const [workspace] = await runtime.db
      .insert(organizationWorkspaces)
      .values({
        ideUrl: runtimeState.ideUrl ?? null,
        imageFlavor: body.imageFlavor,
        nixPackages: body.nixPackages,
        previewUrl: runtimeState.previewUrl ?? null,
        provider: runtimeState.provider ?? body.provider,
        repoName: body.repoName,
        repoOwner: body.repoOwner,
        repoProvider: body.repoProvider,
        status: runtimeState.status,
        tenantId: tenant.id,
        updatedAt: runtimeState.updatedAt ?? new Date(),
        workspaceId: runtimeState.workspaceId,
      })
      .returning();

    await recordActivityEvent({
      actorUserId: accessResult.access.session.user.id,
      description: `Devbox ${workspace.workspaceId} was created for ${tenant.name}.`,
      kind: "workspace_created",
      organizationId: accessResult.access.organizationId,
      status: workspace.status,
      tenantId: tenant.id,
      title: workspace.workspaceId,
      workspaceRecordId: workspace.id,
    });

    return c.json({ workspace: mergeWorkspaceRecord(workspace, runtimeState) }, 201);
  } catch (error) {
    try {
      await deleteProvisionerWorkspace(runtimeState.workspaceId);
    } catch (cleanupError) {
      if (!(cleanupError instanceof ProvisionerError && cleanupError.status === 404)) {
        c.get("log").error(toLoggableError(cleanupError), {
          workspaceProvisioningCleanup: {
            workspaceId: runtimeState.workspaceId,
          },
        });
      }
    }

    if (isUniqueViolation(error)) {
      return c.json({ error: "workspace_conflict" }, 409);
    }

    throw error;
  }
});

app.delete(`${internalApiEnv.API_PREFIX}/workspaces/:workspaceId`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = deleteWorkspaceParamsSchema.parse({
    workspaceId: c.req.param("workspaceId"),
  });
  const [record] = await runtime.db
    .select({
      workspace: organizationWorkspaces,
    })
    .from(organizationWorkspaces)
    .innerJoin(organizationTenants, eq(organizationWorkspaces.tenantId, organizationTenants.id))
    .where(
      and(
        eq(organizationTenants.organizationId, accessResult.access.organizationId),
        sql`${organizationWorkspaces.workspaceId} = ${params.workspaceId} or ${organizationWorkspaces.id}::text = ${params.workspaceId}`,
      ),
    )
    .limit(1);

  if (!record) {
    return c.json({ error: "workspace_not_found" }, 404);
  }

  try {
    await deleteProvisionerWorkspace(record.workspace.workspaceId);
  } catch (error) {
    if (!(error instanceof ProvisionerError && error.status === 404)) {
      return buildProvisionerErrorResponse(c, error);
    }
  }

  await runtime.db
    .delete(organizationWorkspaces)
    .where(eq(organizationWorkspaces.id, record.workspace.id));

  await recordActivityEvent({
    actorUserId: accessResult.access.session.user.id,
    description: `Devbox ${record.workspace.workspaceId} was deleted.`,
    kind: "workspace_deleted",
    metadata: {
      provider: record.workspace.provider,
      repoName: record.workspace.repoName,
      repoOwner: record.workspace.repoOwner,
      workspaceId: record.workspace.workspaceId,
    },
    organizationId: accessResult.access.organizationId,
    status: "deleted",
    tenantId: record.workspace.tenantId,
    title: record.workspace.workspaceId,
    workspaceRecordId: null,
  });

  return c.json({ ok: true });
});

app.get(`${internalApiEnv.API_PREFIX}/dispatches`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const query = listDispatchesQuerySchema.parse({
    requestedBy: c.req.query("requestedBy") ?? undefined,
    source: c.req.query("source") ?? undefined,
    tenantId: c.req.query("tenantId") ?? undefined,
  });
  const filters = [eq(dispatches.organizationId, accessResult.access.organizationId)];

  if (query.tenantId) {
    filters.push(eq(dispatches.tenantId, query.tenantId));
  }

  if (query.source) {
    filters.push(eq(dispatches.source, query.source));
  }

  if (query.requestedBy === "self") {
    filters.push(eq(dispatches.requestedByUserId, accessResult.access.session.user.id));
  }

  const dispatchRecords = await runtime.db
    .select()
    .from(dispatches)
    .where(and(...filters))
    .orderBy(desc(dispatches.createdAt))
    .limit(50);

  return c.json({
    dispatches: await buildDispatchResponseItems(dispatchRecords),
  });
});

app.get(`${internalApiEnv.API_PREFIX}/runs`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const query = listRunsQuerySchema.parse({
    requestedBy: c.req.query("requestedBy") ?? undefined,
    source: c.req.query("source") ?? undefined,
    tenantId: c.req.query("tenantId") ?? undefined,
  });

  const filters = [eq(runs.organizationId, accessResult.access.organizationId)];

  if (query.tenantId) {
    filters.push(eq(runs.tenantId, query.tenantId));
  }

  if (query.source) {
    filters.push(eq(runs.source, query.source));
  }

  if (query.requestedBy === "self") {
    filters.push(eq(runs.requestedByUserId, accessResult.access.session.user.id));
  }

  const runRecords = await runtime.db
    .select()
    .from(runs)
    .where(and(...filters))
    .orderBy(desc(runs.createdAt))
    .limit(50);

  return c.json({
    runs: await buildRunResponseItems(runRecords),
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runs`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const body = createRunSchema.parse(await c.req.json());
  const project = await getOrganizationTenantRecord(
    accessResult.access.organizationId,
    body.tenantId,
  );

  if (!project) {
    return c.json({ error: "project_not_found" }, 404);
  }

  const blueprint =
    body.blueprintId != null
      ? await getAccessibleBlueprintRecord(accessResult.access.organizationId, body.blueprintId)
      : project.defaultBlueprintId
        ? await getAccessibleBlueprintRecord(
            accessResult.access.organizationId,
            project.defaultBlueprintId,
          )
        : await getDefaultBlueprintRecord(accessResult.access.organizationId);

  if (body.blueprintId != null && !blueprint) {
    return c.json({ error: "blueprint_not_found" }, 404);
  }

  try {
    const dispatchRecord = await createDispatchRecord({
      blueprint,
      objective: body.objective,
      organizationId: accessResult.access.organizationId,
      project,
      requestPayload: {
        requestedBlueprintId: body.blueprintId ?? null,
        requestedTenantId: body.tenantId,
        resolvedBlueprintId: blueprint?.id ?? null,
      },
      requestedByEmail: accessResult.access.session.user.email,
      requestedByName: accessResult.access.session.user.name,
      requestedByUserId: accessResult.access.session.user.id,
      source: body.source,
      sourceMetadata: {
        apiPath: `${internalApiEnv.API_PREFIX}/runs`,
        trigger: "manual_run_dispatch",
      },
      title: body.title,
    });
    const latestRun = await createRunWithProvisioning({
      blueprint,
      dispatchRecord,
      objective: body.objective,
      organizationId: accessResult.access.organizationId,
      project,
      requestedByUserId: accessResult.access.session.user.id,
      source: body.source,
      title: body.title,
    });

    return c.json({ run: latestRun }, 201);
  } catch (error) {
    if (error instanceof ProvisionerError) {
      return buildProvisionerErrorResponse(c, error);
    }

    throw error;
  }
});

app.get(`${internalApiEnv.API_PREFIX}/runs/:runId`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = runIdParamsSchema.parse({
    runId: c.req.param("runId"),
  });
  const [runRecord] = await runtime.db
    .select()
    .from(runs)
    .where(
      and(eq(runs.id, params.runId), eq(runs.organizationId, accessResult.access.organizationId)),
    )
    .limit(1);

  if (!runRecord) {
    return c.json({ error: "run_not_found" }, 404);
  }

  return c.json({
    run: await buildRunDetailResponse(runRecord),
  });
});

app.post(`${internalApiEnv.API_PREFIX}/runs/:runId/retry`, async (c) => {
  const accessResult = await requireOrganizationAccess(c, {
    requireAdmin: true,
  });

  if (accessResult.response) {
    return accessResult.response;
  }

  const params = retryRunParamsSchema.parse({
    runId: c.req.param("runId"),
  });
  const [runRecord] = await runtime.db
    .select()
    .from(runs)
    .where(
      and(eq(runs.id, params.runId), eq(runs.organizationId, accessResult.access.organizationId)),
    )
    .limit(1);

  if (!runRecord) {
    return c.json({ error: "run_not_found" }, 404);
  }

  const project = await getOrganizationTenantRecord(
    accessResult.access.organizationId,
    runRecord.tenantId,
  );

  if (!project) {
    return c.json({ error: "project_not_found" }, 404);
  }

  const blueprint =
    runRecord.blueprintId != null
      ? await getAccessibleBlueprintRecord(
          accessResult.access.organizationId,
          runRecord.blueprintId,
        )
      : project.defaultBlueprintId
        ? await getAccessibleBlueprintRecord(
            accessResult.access.organizationId,
            project.defaultBlueprintId,
          )
        : await getDefaultBlueprintRecord(accessResult.access.organizationId);

  try {
    const dispatchRecord = await createDispatchRecord({
      blueprint,
      objective: runRecord.objective,
      organizationId: accessResult.access.organizationId,
      project,
      requestPayload: {
        requestedTenantId: runRecord.tenantId,
        resolvedBlueprintId: blueprint?.id ?? null,
        retryOfRunId: runRecord.id,
        retrySource: runRecord.source,
      },
      requestedByEmail: accessResult.access.session.user.email,
      requestedByName: accessResult.access.session.user.name,
      requestedByUserId: accessResult.access.session.user.id,
      source: runRecord.source as z.infer<typeof runSourceSchema>,
      sourceMetadata: {
        apiPath: `${internalApiEnv.API_PREFIX}/runs/${runRecord.id}/retry`,
        trigger: "retry_run_dispatch",
      },
      title: `${runRecord.title} (retry)`,
    });
    const retriedRun = await createRunWithProvisioning({
      blueprint,
      dispatchRecord,
      objective: runRecord.objective,
      organizationId: accessResult.access.organizationId,
      project,
      requestedByUserId: accessResult.access.session.user.id,
      source: runRecord.source as z.infer<typeof runSourceSchema>,
      title: `${runRecord.title} (retry)`,
    });

    return c.json({ run: retriedRun }, 201);
  } catch (error) {
    if (error instanceof ProvisionerError) {
      return buildProvisionerErrorResponse(c, error);
    }

    throw error;
  }
});

app.get(`${internalApiEnv.API_PREFIX}/pull-requests`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const query = listPullRequestsQuerySchema.parse({
    requestedBy: c.req.query("requestedBy") ?? undefined,
  });
  const filters = [
    eq(runs.organizationId, accessResult.access.organizationId),
    sql`${runs.prUrl} is not null`,
  ];

  if (query.requestedBy === "self") {
    filters.push(eq(runs.requestedByUserId, accessResult.access.session.user.id));
  }

  const runRecords = await runtime.db
    .select()
    .from(runs)
    .where(and(...filters))
    .orderBy(desc(runs.updatedAt))
    .limit(50);
  const items = await buildRunResponseItems(runRecords);
  const pullRequests = await Promise.all(
    items
      .filter((item) => item.prUrl != null)
      .map(async (item) => {
        const metadata = await readGitHubPullRequestMetadata(item.prUrl ?? "");

        return {
          additions: metadata.additions,
          authorLogin: metadata.authorLogin,
          baseBranch: metadata.baseBranch,
          branchName: item.branchName,
          changedFiles: metadata.changedFiles,
          checksStatus: metadata.checksStatus,
          commitCount: metadata.commitCount,
          commentCount: metadata.commentCount,
          completedAt: item.completedAt,
          createdAt: item.createdAt,
          githubLineChangeCount: metadata.lineChangeCount,
          githubState: metadata.githubState,
          githubUpdatedAt: metadata.githubUpdatedAt,
          headBranch: metadata.headBranch,
          headSha: metadata.headSha,
          id: item.id,
          isDraft: metadata.isDraft,
          labels: metadata.labels,
          mergeable: metadata.mergeable,
          mergeableState: metadata.mergeableState,
          metadataError: metadata.metadataError,
          prCreatedAt: metadata.createdAt,
          prNumber: metadata.prNumber,
          prTitle: metadata.prTitle,
          prUrl: item.prUrl,
          prState: metadata.githubState,
          projectName: item.projectName,
          projectSlug: item.projectSlug,
          repoFullName:
            metadata.repoOwner && metadata.repoName
              ? `${metadata.repoOwner}/${metadata.repoName}`
              : null,
          repoName: metadata.repoName,
          repoOwner: metadata.repoOwner,
          requestedBy: item.requestedBy,
          requestedReviewerCount: metadata.requestedReviewerCount,
          requestedReviewerLogins: metadata.requestedReviewerLogins,
          reviewCommentCount: metadata.reviewCommentCount,
          runId: item.id,
          source: item.source,
          status: item.status,
          summary: item.resultSummary,
          title: item.title,
          updatedAt: item.updatedAt,
          deletions: metadata.deletions,
        };
      }),
  );

  return c.json({
    pullRequests,
  });
});

app.get(`${internalApiEnv.API_PREFIX}/usage`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const organizationId = accessResult.access.organizationId;
  const [projectRecords, runRecords, workspaceRecords, membershipCount] = await Promise.all([
    runtime.db
      .select()
      .from(organizationTenants)
      .where(eq(organizationTenants.organizationId, organizationId))
      .orderBy(organizationTenants.name),
    runtime.db
      .select()
      .from(runs)
      .where(eq(runs.organizationId, organizationId))
      .orderBy(desc(runs.createdAt)),
    runtime.db
      .select({
        workspace: organizationWorkspaces,
      })
      .from(organizationWorkspaces)
      .innerJoin(organizationTenants, eq(organizationWorkspaces.tenantId, organizationTenants.id))
      .where(
        and(
          eq(organizationTenants.organizationId, organizationId),
          sql`${organizationWorkspaces.status} <> 'deleted'`,
        ),
      ),
    runtime.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId))
      .limit(1),
  ]);

  const now = Date.now();
  const workspaceRecordsOnly = workspaceRecords.map((entry) => entry.workspace);

  const projectUsage = projectRecords.map((projectRecord) => {
    const projectRuns = runRecords.filter((runRecord) => runRecord.tenantId === projectRecord.id);
    const projectWorkspaces = workspaceRecordsOnly.filter(
      (workspaceRecord) => workspaceRecord.tenantId === projectRecord.id,
    );
    const completedRuns = projectRuns.filter((runRecord) => runRecord.status === "completed");
    const openPullRequests = projectRuns.filter((runRecord) => runRecord.prUrl != null).length;
    const computeMinutes = Math.ceil(
      projectRuns.reduce((total, runRecord) => {
        const start = runRecord.startedAt ?? runRecord.createdAt;
        const end = runRecord.completedAt ?? runRecord.updatedAt ?? runRecord.createdAt;

        if (!start) {
          return total;
        }

        const startMs = new Date(start).getTime();
        const endMs = new Date(end ?? now).getTime();

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
          return total;
        }

        return total + Math.max(1, Math.round((endMs - startMs) / 60_000));
      }, 0),
    );

    return {
      activeSeats: membershipCount[0]?.count ?? 0,
      billingEmail: projectRecord.billingEmail,
      billingPlan: projectRecord.billingPlan,
      billingReference: projectRecord.billingReference,
      billingStatus: projectRecord.billingStatus,
      completedRuns: completedRuns.length,
      computeMinutes,
      id: projectRecord.id,
      lastRunAt: projectRecord.lastRunAt,
      name: projectRecord.name,
      openPullRequests,
      readyWorkspaces: projectWorkspaces.filter((workspaceRecord) =>
        workspaceStatusIsReady(workspaceRecord.status),
      ).length,
      runCount: projectRuns.length,
      seatLimit: projectRecord.seatLimit,
      slug: projectRecord.slug,
    };
  });

  return c.json({
    projects: projectUsage,
    summary: {
      activeSeats: membershipCount[0]?.count ?? 0,
      computeMinutes: projectUsage.reduce((total, project) => total + project.computeMinutes, 0),
      openPullRequests: projectUsage.reduce(
        (total, project) => total + project.openPullRequests,
        0,
      ),
      readyWorkspaces: projectUsage.reduce((total, project) => total + project.readyWorkspaces, 0),
      runCount: projectUsage.reduce((total, project) => total + project.runCount, 0),
      seatLimit: projectUsage.reduce((total, project) => total + (project.seatLimit ?? 0), 0),
    },
  });
});

app.post(`${internalApiEnv.API_PREFIX}/dispatch/slack`, async (c) => {
  const sharedSecret =
    c.req.header("x-firapps-dispatch-secret") ??
    c.req.header("x-dispatch-secret") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  if (sharedSecret !== internalApiEnv.DISPATCH_WEBHOOK_SECRET) {
    return c.json({ error: "dispatch_unauthorized" }, 401);
  }

  const contentType = c.req.header("content-type") ?? "";
  const dispatchInput = contentType.includes("application/x-www-form-urlencoded")
    ? (() => {
        const formDataPromise = c.req.formData();

        return formDataPromise.then((formData) => {
          const parsedText = parseSlackDispatchText(readFormDataString(formData, "text"));
          const parsedInput = slackDispatchInputSchema.parse({
            blueprintSlug: parsedText.blueprint ?? parsedText.blueprintslug,
            objective: parsedText.objective ?? parsedText.obj ?? "",
            requestedByEmail: undefined,
            organizationSlug:
              parsedText.organization ?? parsedText.org ?? parsedText.organizationslug,
            projectSlug: parsedText.project ?? parsedText.projectslug ?? "",
            requestedByName:
              readFormDataString(formData, "user_name") ||
              readFormDataString(formData, "user_id") ||
              undefined,
            title: parsedText.title ?? `Slack dispatch for ${parsedText.project ?? "project"}`,
          });

          return {
            parsedInput,
            requestPayload: {
              blueprintSlug: parsedInput.blueprintSlug ?? null,
              organizationSlug: parsedInput.organizationSlug ?? null,
              projectSlug: parsedInput.projectSlug,
            },
            sourceMetadata: {
              command: readFormDataString(formData, "command") || null,
              contentType,
              responseUrl: readFormDataString(formData, "response_url") || null,
              slackChannelId: readFormDataString(formData, "channel_id") || null,
              slackChannelName: readFormDataString(formData, "channel_name") || null,
              slackTeamDomain: readFormDataString(formData, "team_domain") || null,
              slackTeamId: readFormDataString(formData, "team_id") || null,
              slackTriggerId: readFormDataString(formData, "trigger_id") || null,
              slackUserId: readFormDataString(formData, "user_id") || null,
              slackUserName: readFormDataString(formData, "user_name") || null,
              transport: "slack_form",
            },
          };
        });
      })()
    : (async () => {
        const rawPayload = await c.req.json();
        const parsedInput = slackDispatchInputSchema.parse(rawPayload);

        return {
          parsedInput,
          requestPayload: toDispatchMetadata(rawPayload),
          sourceMetadata: {
            contentType,
            transport: "json_webhook",
          },
        };
      })();
  const { parsedInput, requestPayload, sourceMetadata } = await dispatchInput;
  const projectRecord = await resolveProjectFromDispatch({
    organizationSlug: parsedInput.organizationSlug,
    projectSlug: parsedInput.projectSlug,
  });

  if (!projectRecord) {
    return c.json({ error: "dispatch_project_not_found" }, 404);
  }

  const blueprint = await resolveBlueprintForDispatch({
    blueprintSlug: parsedInput.blueprintSlug,
    defaultBlueprintId: projectRecord.project.defaultBlueprintId,
    organizationId: projectRecord.project.organizationId,
  });

  if (parsedInput.blueprintSlug && !blueprint) {
    return c.json({ error: "dispatch_blueprint_not_found" }, 404);
  }

  const dispatchUser = await ensureDispatchSystemUser();
  const matchedUser =
    parsedInput.requestedByEmail != null
      ? await getOrganizationMemberUserByEmail(
          projectRecord.project.organizationId,
          parsedInput.requestedByEmail,
        )
      : null;
  const requestedByName = parsedInput.requestedByName ?? matchedUser?.name ?? null;
  const requestedByEmail = parsedInput.requestedByEmail ?? matchedUser?.email ?? null;

  try {
    const dispatchRecord = await createDispatchRecord({
      blueprint,
      objective: parsedInput.objective,
      organizationId: projectRecord.project.organizationId,
      project: projectRecord.project,
      requestPayload,
      requestedByEmail,
      requestedByName,
      requestedByUserId: matchedUser?.id ?? null,
      source: "slack",
      sourceMetadata,
      title: parsedInput.title,
    });
    const run = await createRunWithProvisioning({
      blueprint,
      dispatchRecord,
      objective: parsedInput.objective,
      organizationId: projectRecord.project.organizationId,
      project: projectRecord.project,
      requestedByUserId: matchedUser?.id ?? dispatchUser.id,
      source: "slack",
      title: parsedInput.title,
    });

    return c.json(
      {
        ok: true,
        run,
        text: `Dispatched ${run.title} for ${projectRecord.project.name}.`,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ProvisionerError) {
      return buildProvisionerErrorResponse(c, error);
    }

    throw error;
  }
});

app.get(`${internalApiEnv.API_PREFIX}/operator`, async (c) => {
  const session = await requireSession(c.req.raw.headers);

  if (!session?.user) {
    return c.json({ error: "session_required" }, 401);
  }

  const allowedOperatorEmails = listOperatorEmails();
  const sessionEmail = session.user.email?.trim() ?? "";

  if (allowedOperatorEmails.length === 0) {
    return c.json({ error: "operator_access_not_configured" }, 403);
  }

  if (!operatorEmailAllowed(sessionEmail, allowedOperatorEmails)) {
    return c.json({ error: "operator_forbidden" }, 403);
  }

  const [
    activityRows,
    organizationRecords,
    projectRecords,
    runRecords,
    workspaceRows,
    invitationRows,
    memberRows,
  ] = await Promise.all([
    runtime.db.select().from(activityEvents).orderBy(desc(activityEvents.occurredAt)).limit(25),
    runtime.db.select().from(organizations).orderBy(organizations.name),
    runtime.db.select().from(organizationTenants).orderBy(organizationTenants.name),
    runtime.db.select().from(runs).orderBy(desc(runs.updatedAt)).limit(100),
    runtime.db
      .select()
      .from(organizationWorkspaces)
      .where(sql`${organizationWorkspaces.status} <> 'deleted'`)
      .orderBy(desc(organizationWorkspaces.updatedAt)),
    runtime.db
      .select()
      .from(organizationInvitations)
      .orderBy(desc(organizationInvitations.createdAt))
      .limit(50),
    runtime.db.select().from(organizationMemberships),
  ]);

  const services = [
    {
      detail: "The product control plane is answering in-cluster.",
      name: "internal-api",
      status: "healthy",
    },
  ];
  let runtimeSnapshot: Awaited<ReturnType<typeof readProvisionerOperatorRuntime>> | null = null;

  try {
    await runtime.db.execute(sql`select 1`);
    services.push({
      detail: "Operations database query succeeded.",
      name: "database",
      status: "healthy",
    });
  } catch (error) {
    services.push({
      detail: error instanceof Error ? error.message : "Operations database probe failed.",
      name: "database",
      status: "failed",
    });
  }

  if (internalApiEnv.PLATFORM_PROVISIONER_BASE_URL) {
    try {
      const healthUrl = new URL(
        "../healthz",
        internalApiEnv.PLATFORM_PROVISIONER_BASE_URL,
      ).toString();
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(5_000),
      });

      services.push({
        detail: response.ok
          ? "Workspace provisioner health probe passed."
          : `Workspace provisioner returned ${response.status}.`,
        name: "workspace-provisioner",
        status: response.ok ? "healthy" : "degraded",
      });
    } catch (error) {
      services.push({
        detail:
          error instanceof Error ? error.message : "Workspace provisioner health probe failed.",
        name: "workspace-provisioner",
        status: "failed",
      });
    }

    try {
      runtimeSnapshot = await readProvisionerOperatorRuntime();

      for (const service of runtimeSnapshot.services ?? []) {
        services.push({
          detail: service.detail,
          name: service.name,
          status: service.status,
        });
      }
    } catch (error) {
      services.push({
        detail: error instanceof Error ? error.message : "Sandbox runtime snapshot probe failed.",
        name: "sandbox-runtime",
        status: "failed",
      });
    }
  }

  if (internalApiEnv.MAILPIT_API_URL) {
    try {
      const response = await fetch(internalApiEnv.MAILPIT_API_URL, {
        signal: AbortSignal.timeout(5_000),
      });
      const payload = response.ok ? ((await response.json()) as { messages?: unknown[] }) : null;

      services.push({
        detail: response.ok
          ? `Mailpit API reachable with ${payload?.messages?.length ?? 0} messages.`
          : `Mailpit API returned ${response.status}.`,
        name: "mailpit",
        status: response.ok ? "healthy" : "degraded",
      });
    } catch (error) {
      services.push({
        detail: error instanceof Error ? error.message : "Mailpit API probe failed.",
        name: "mailpit",
        status: "failed",
      });
    }
  }

  return c.json({
    generatedAt: new Date().toISOString(),
    organizations: organizationRecords.map((organizationRecord) => {
      const organizationProjects = projectRecords.filter(
        (projectRecord) => projectRecord.organizationId === organizationRecord.id,
      );
      const organizationRuns = runRecords.filter(
        (runRecord) => runRecord.organizationId === organizationRecord.id,
      );

      return {
        activeRuns: organizationRuns.filter((runRecord) =>
          ["blocked", "provisioning", "queued", "workspace_ready"].includes(runRecord.status),
        ).length,
        failedRuns: organizationRuns.filter((runRecord) => runRecord.status === "failed").length,
        id: organizationRecord.id,
        memberCount: memberRows.filter(
          (memberRecord) => memberRecord.organizationId === organizationRecord.id,
        ).length,
        name: organizationRecord.name,
        pendingInvitations: invitationRows.filter(
          (invitationRecord) =>
            invitationRecord.organizationId === organizationRecord.id &&
            invitationRecord.status === "pending",
        ).length,
        projectCount: organizationProjects.length,
        readyWorkspaces: workspaceRows.filter((workspaceRecord) => {
          const projectRecord = organizationProjects.find(
            (candidate) => candidate.id === workspaceRecord.tenantId,
          );

          return projectRecord && workspaceStatusIsReady(workspaceRecord.status);
        }).length,
        slug: organizationRecord.slug,
      };
    }),
    queue: runRecords.slice(0, 12).map((runRecord) => ({
      id: runRecord.id,
      projectId: runRecord.tenantId,
      source: runRecord.source,
      status: runRecord.status,
      title: runRecord.title,
      updatedAt: runRecord.updatedAt,
    })),
    recentActivity: activityRows.map((record) => ({
      description: record.description,
      id: record.id,
      kind: record.kind,
      occurredAt: record.occurredAt,
      organizationId: record.organizationId,
      runId: record.runId,
      status: record.status,
      tenantId: record.tenantId,
      title: record.title,
      workspaceRecordId: record.workspaceRecordId,
    })),
    recentFailures: runRecords
      .filter((runRecord) => runRecord.status === "failed")
      .slice(0, 8)
      .map((runRecord) => ({
        failureMessage: runRecord.failureMessage,
        id: runRecord.id,
        title: runRecord.title,
        updatedAt: runRecord.updatedAt,
      })),
    runtime: runtimeSnapshot,
    services,
    summary: {
      failedRuns: runRecords.filter((runRecord) => runRecord.status === "failed").length,
      organizations: organizationRecords.length,
      projects: projectRecords.length,
      readyWorkspaces: workspaceRows.filter((workspaceRecord) =>
        workspaceStatusIsReady(workspaceRecord.status),
      ).length,
      runs: runRecords.length,
    },
  });
});

app.get(`${internalApiEnv.API_PREFIX}/activity`, async (c) => {
  const accessResult = await requireOrganizationAccess(c);

  if (accessResult.response) {
    return accessResult.response;
  }

  const organizationId = accessResult.access.organizationId;
  const activityEventRecords = await runtime.db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.organizationId, organizationId))
    .orderBy(desc(activityEvents.occurredAt))
    .limit(50);

  if (activityEventRecords.length > 0) {
    return c.json({
      activity: activityEventRecords.map((record) => ({
        description: record.description,
        id: record.id,
        kind: record.kind,
        occurredAt: record.occurredAt,
        status: record.status,
        title: record.title,
      })),
    });
  }

  const [projectRecords, workspaceRecords, runRecords, invitationRecords] = await Promise.all([
    runtime.db
      .select({
        createdAt: organizationTenants.createdAt,
        id: organizationTenants.id,
        name: organizationTenants.name,
      })
      .from(organizationTenants)
      .where(eq(organizationTenants.organizationId, organizationId))
      .orderBy(desc(organizationTenants.createdAt))
      .limit(5),
    runtime.db
      .select({
        createdAt: organizationWorkspaces.createdAt,
        id: organizationWorkspaces.id,
        status: organizationWorkspaces.status,
        workspaceId: organizationWorkspaces.workspaceId,
      })
      .from(organizationWorkspaces)
      .innerJoin(organizationTenants, eq(organizationWorkspaces.tenantId, organizationTenants.id))
      .where(eq(organizationTenants.organizationId, organizationId))
      .orderBy(desc(organizationWorkspaces.createdAt))
      .limit(5),
    runtime.db
      .select({
        createdAt: runs.createdAt,
        id: runs.id,
        status: runs.status,
        title: runs.title,
      })
      .from(runs)
      .where(eq(runs.organizationId, organizationId))
      .orderBy(desc(runs.createdAt))
      .limit(5),
    runtime.db
      .select({
        createdAt: organizationInvitations.createdAt,
        email: organizationInvitations.email,
        id: organizationInvitations.id,
        status: organizationInvitations.status,
      })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.organizationId, organizationId))
      .orderBy(desc(organizationInvitations.createdAt))
      .limit(5),
  ]);

  const activity = [
    ...projectRecords.map((record) => ({
      description: `Project ${record.name} was created.`,
      id: record.id,
      kind: "project_created",
      occurredAt: record.createdAt,
      status: "completed",
      title: record.name,
    })),
    ...workspaceRecords.map((record) => ({
      description: `Devbox ${record.workspaceId} is currently ${record.status}.`,
      id: record.id,
      kind: "workspace_updated",
      occurredAt: record.createdAt,
      status: record.status,
      title: record.workspaceId,
    })),
    ...runRecords.map((record) => ({
      description: `Run ${record.title} is currently ${record.status}.`,
      id: record.id,
      kind: "run_updated",
      occurredAt: record.createdAt,
      status: record.status,
      title: record.title,
    })),
    ...invitationRecords.map((record) => ({
      description: `Invitation for ${record.email} is ${record.status}.`,
      id: record.id,
      kind: "invitation_updated",
      occurredAt: record.createdAt,
      status: record.status,
      title: record.email,
    })),
  ]
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .slice(0, 20);

  return c.json({ activity });
});

requestActiveRunReconciliation();
const runReconciliationInterval = setInterval(() => {
  requestActiveRunReconciliation();
}, internalApiEnv.RUN_RECONCILE_INTERVAL_MS);

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
  clearInterval(runReconciliationInterval);
  server.close();
  await closeDatabase(runtime);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
