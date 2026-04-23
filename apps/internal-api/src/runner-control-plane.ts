import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import type { JsonValue, RunnerMetadata, RunnerOperation } from "./db/schema.js";

export const runnerProtocolVersion = "runner-v1";
export const runnerSessionTtlMs = 15 * 60 * 1000;
export const defaultRunnerLeaseSeconds = 300;

export const runnerOperations = [
  "repo.prepare",
  "git.clone",
  "git.push",
  "github.create_pr",
  "agent.forward_message",
  "container.start",
  "container.stop",
  "artifact.upload",
] as const satisfies [RunnerOperation, ...RunnerOperation[]];

const runnerOperationValues = runnerOperations;
const maxAgentMessageBytes = 50_000;
const maxArtifactValueBytes = 200_000;
const maxHandlerDelayMillis = 5_000;

const safeCheckoutId = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const safeContainerName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const safeGitHubName = /^[A-Za-z0-9_.-]{1,100}$/;
const safeGitRef = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/;
const safeGitRemote = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export const runnerJobTerminalStatuses = ["completed", "failed", "cancelled"] as const;
export const runnerJobActiveLeaseStatuses = ["leased", "running"] as const;
export const runnerJobCancellationStatuses = ["cancelling", "cancelled"] as const;

const forbiddenStructuredKeys = new Set([
  "args",
  "argv",
  "cmd",
  "command",
  "commandargs",
  "dockerargs",
  "dockercli",
  "dockercommand",
  "hostmount",
  "hostmounts",
  "hostpath",
  "hostpaths",
  "mount",
  "mounts",
  "privileged",
  "script",
  "shell",
]);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const runnerMetadataSchema = z
  .record(z.string(), jsonValueSchema)
  .default({})
  .superRefine((value, ctx) => {
    for (const path of findForbiddenStructuredFields(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "runner instructions must be structured and must not contain shell, argv, Docker CLI, privileged, or host mount fields",
        path,
      });
    }
  });

export const runnerOperationSchema = z.enum(runnerOperationValues);

const protocolVersionSchema = z.literal(runnerProtocolVersion);

const runnerParamsSchema = <TShape extends z.ZodRawShape>(shape: TShape) =>
  z
    .object(shape)
    .strict()
    .superRefine((value, ctx) => {
      for (const path of findForbiddenStructuredFields(value as JsonValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "runner instructions must be structured and must not contain shell, argv, Docker CLI, privileged, or host mount fields",
          path,
        });
      }
    });

const checkoutIdSchema = z
  .string()
  .trim()
  .regex(safeCheckoutId, "checkoutId contains unsupported characters");

const gitRefSchema = (name: string) =>
  z
    .string()
    .trim()
    .min(1, `${name} is required`)
    .max(200, `${name} must be at most 200 bytes`)
    .regex(safeGitRef, `${name} contains unsupported characters`)
    .superRefine((value, ctx) => {
      if (
        value.startsWith("-") ||
        value.startsWith("/") ||
        value.includes("..") ||
        value.includes("@{") ||
        value.includes("//") ||
        value.endsWith("/") ||
        value.endsWith(".lock")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} is not an allowed git ref`,
        });
      }
    });

const gitBranchSchema = (name: string) =>
  gitRefSchema(name).superRefine((value, ctx) => {
    if (value.startsWith("refs/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${name} must be a branch name, not a full ref`,
      });
    }
  });

const repositoryUrlSchema = z
  .string()
  .trim()
  .min(1, "repositoryUrl is required")
  .max(2048, "repositoryUrl must be at most 2048 bytes")
  .superRefine((value, ctx) => {
    let parsed: URL;

    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "repositoryUrl must be an absolute git URL",
      });
      return;
    }

    if (parsed.username || parsed.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "repositoryUrl must not include embedded credentials",
      });
      return;
    }

    if (parsed.protocol === "https:") {
      return;
    }

    if (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    ) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "repositoryUrl must use https except for loopback http fixtures",
    });
  });

const repositoryParamsSchema = runnerParamsSchema({
  branch: gitBranchSchema("branch").optional(),
  checkoutId: checkoutIdSchema.optional(),
  ref: gitRefSchema("ref"),
  repositoryUrl: repositoryUrlSchema,
});

const gitPushParamsSchema = runnerParamsSchema({
  branch: gitBranchSchema("branch"),
  checkoutId: checkoutIdSchema,
  remoteName: z
    .string()
    .trim()
    .regex(safeGitRemote, "remoteName contains unsupported characters")
    .optional(),
  repositoryUrl: repositoryUrlSchema,
});

const githubCreatePrParamsSchema = runnerParamsSchema({
  base: gitBranchSchema("base"),
  body: z.string().max(maxArtifactValueBytes).optional(),
  branch: gitBranchSchema("branch"),
  draft: z.boolean().optional(),
  owner: z
    .string()
    .trim()
    .min(1, "owner is required")
    .max(100)
    .regex(safeGitHubName, "owner contains unsupported characters"),
  repo: z
    .string()
    .trim()
    .min(1, "repo is required")
    .max(100)
    .regex(safeGitHubName, "repo contains unsupported characters"),
  title: z.string().trim().min(1, "title is required").max(256),
});

const agentForwardMessageParamsSchema = runnerParamsSchema({
  content: z.string().trim().min(1, "content is required").max(maxAgentMessageBytes),
  delayMillis: z.number().int().min(0).max(maxHandlerDelayMillis).optional(),
  messageId: z.string().trim().min(1, "messageId is required").max(160),
  metadata: z.record(z.string(), z.string()).optional(),
  taskId: z.string().trim().min(1, "taskId is required").max(160),
});

const containerStartParamsSchema = runnerParamsSchema({
  containerName: z
    .string()
    .trim()
    .regex(safeContainerName, "containerName contains unsupported characters")
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
  image: z
    .string()
    .trim()
    .min(1, "container.start image is required")
    .max(512)
    .refine((value) => value.includes("@sha256:"), {
      message: "container.start image must be pinned by digest",
    }),
  tenantId: z.string().uuid("tenantId is required for runner-owned container labels"),
});

const containerStopParamsSchema = runnerParamsSchema({
  containerId: z.string().trim().min(1, "containerId is required").max(160),
  timeoutSeconds: z.number().int().min(0).max(60).optional(),
});

const artifactUploadParamsSchema = runnerParamsSchema({
  artifactType: z.string().trim().min(1, "artifactType is required").max(120),
  label: z.string().trim().min(1, "label is required").max(160),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
  url: z.string().trim().url("url must be absolute when provided").optional(),
  value: z.string().max(maxArtifactValueBytes).optional(),
}).superRefine((value, ctx) => {
  if (!value.value && !value.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "artifact.upload requires value or url",
      path: ["value"],
    });
  }
});

export const createRunnerRegistrationSchema = z
  .object({
    allowedOperations: z.array(runnerOperationSchema).min(1).optional(),
    apiKeyExpiresAt: z.string().datetime().nullable().optional(),
    capabilityScopes: runnerMetadataSchema.optional(),
    displayName: z.string().trim().min(1).max(120),
    maxConcurrency: z.number().int().min(1).max(16).optional().default(1),
    repositoryScopes: runnerMetadataSchema.optional(),
    tenantId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const createRunnerSessionSchema = z
  .object({
    hostCapabilities: runnerMetadataSchema.optional(),
    imageDigest: z.string().trim().min(1).max(200).optional(),
    protocolVersion: protocolVersionSchema,
    runnerVersion: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const runnerHeartbeatSchema = z
  .object({
    cleanupState: z.string().trim().min(1).max(120).optional(),
    currentConcurrency: z.number().int().min(0).max(1024).optional().default(0),
    hostCapabilities: runnerMetadataSchema.optional(),
    imageDigest: z.string().trim().min(1).max(200).optional(),
    protocolVersion: protocolVersionSchema,
    runnerVersion: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const claimRunnerJobSchema = z
  .object({
    capacity: z.number().int().min(1).max(16).optional().default(1),
    currentConcurrency: z.number().int().min(0).max(1024).optional().default(0),
    protocolVersion: protocolVersionSchema,
    supportedOperations: z.array(runnerOperationSchema).min(1).optional(),
  })
  .strict();

const createRunnerJobBaseSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(160).optional(),
    runId: z.string().uuid().nullable().optional(),
    runnerId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid(),
  })
  .strict();

const createRunnerJobVariant = <TOperation extends RunnerOperation, TParams extends z.ZodTypeAny>(
  operation: TOperation,
  params: TParams,
) =>
  createRunnerJobBaseSchema.extend({
    operation: z.literal(operation),
    params,
  });

export const createRunnerJobSchema = z.discriminatedUnion("operation", [
  createRunnerJobVariant("repo.prepare", repositoryParamsSchema),
  createRunnerJobVariant("git.clone", repositoryParamsSchema),
  createRunnerJobVariant("git.push", gitPushParamsSchema),
  createRunnerJobVariant("github.create_pr", githubCreatePrParamsSchema),
  createRunnerJobVariant("agent.forward_message", agentForwardMessageParamsSchema),
  createRunnerJobVariant("container.start", containerStartParamsSchema),
  createRunnerJobVariant("container.stop", containerStopParamsSchema),
  createRunnerJobVariant("artifact.upload", artifactUploadParamsSchema),
]);

export const runnerJobIdParamsSchema = z.object({
  jobId: z.string().uuid(),
});

export const runnerIdParamsSchema = z.object({
  runnerId: z.string().uuid(),
});

export const updateRunnerLeaseSchema = z
  .object({
    action: z.enum(["extend", "cancel"]).optional().default("extend"),
    leaseSeconds: z.number().int().min(30).max(3600).optional().default(defaultRunnerLeaseSeconds),
    protocolVersion: protocolVersionSchema,
  })
  .strict();

export const cancelRunnerJobSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const runnerJobCancellationQuerySchema = z
  .object({
    protocolVersion: protocolVersionSchema,
  })
  .strict();

export const runnerJobEventSchema = z
  .object({
    eventKind: z.string().trim().min(1).max(120),
    level: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
    message: z.string().trim().min(1).max(2000),
    metadata: runnerMetadataSchema.optional(),
    protocolVersion: protocolVersionSchema,
  })
  .strict();

export const completeRunnerJobSchema = z
  .object({
    failureMessage: z.string().trim().min(1).max(4000).nullable().optional(),
    protocolVersion: protocolVersionSchema,
    result: runnerMetadataSchema.optional(),
    status: z.enum(["completed", "failed", "cancelled"]),
  })
  .strict();

export const uploadRunnerArtifactsSchema = z
  .object({
    artifacts: z
      .array(
        z
          .object({
            artifactType: z.string().trim().min(1).max(120),
            label: z.string().trim().min(1).max(160),
            metadata: runnerMetadataSchema.optional(),
            url: z.string().trim().url().nullable().optional(),
            value: z.string().max(200_000).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    protocolVersion: protocolVersionSchema,
  })
  .strict();

export function createRunnerApiKey() {
  return `frp_${randomBytes(32).toString("base64url")}`;
}

export function createRunnerSessionToken() {
  return `frs_${randomBytes(32).toString("base64url")}`;
}

export function hashRunnerSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function buildRunnerSecretPreview(secret: string) {
  return `${secret.slice(0, 7)}...${secret.slice(-6)}`;
}

export function nextRunnerSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + runnerSessionTtlMs);
}

export function nextRunnerLeaseExpiry(leaseSeconds = defaultRunnerLeaseSeconds, now = new Date()) {
  return new Date(now.getTime() + leaseSeconds * 1000);
}

export function toRunnerMetadata(value: RunnerMetadata | undefined) {
  return value ?? {};
}

export function isRunnerJobTerminalStatus(status: string) {
  return runnerJobTerminalStatuses.includes(status as (typeof runnerJobTerminalStatuses)[number]);
}

export function runnerJobLeaseIsExpired(
  input: { leaseExpiresAt: Date | null; status: string },
  now = new Date(),
) {
  return (
    !isRunnerJobTerminalStatus(input.status) &&
    input.leaseExpiresAt != null &&
    input.leaseExpiresAt.getTime() <= now.getTime()
  );
}

export function runnerJobLeaseMutationAllowed(
  input: { leaseExpiresAt: Date | null; status: string },
  now = new Date(),
) {
  return (
    ["leased", "running", "cancelling"].includes(input.status) &&
    input.leaseExpiresAt != null &&
    input.leaseExpiresAt.getTime() > now.getTime()
  );
}

export function expiredRunnerLeaseDisposition(
  input: { leaseExpiresAt: Date | null; status: string },
  now = new Date(),
) {
  if (!runnerJobLeaseIsExpired(input, now)) {
    return "none" as const;
  }

  if (input.status === "cancelling") {
    return "cancel" as const;
  }

  if (runnerJobActiveLeaseStatuses.includes(input.status as "leased" | "running")) {
    return "requeue" as const;
  }

  return "none" as const;
}

export function runnerJobCancellationResponse(input: {
  failureMessage: string | null;
  status: string;
}) {
  const cancelled = runnerJobCancellationStatuses.includes(
    input.status as "cancelling" | "cancelled",
  );

  return {
    cancelled,
    job: {
      status: input.status,
    },
    reason: cancelled ? (input.failureMessage ?? "operator requested cancellation") : undefined,
  };
}

function normalizeStructuredKey(key: string) {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function findForbiddenStructuredFields(value: JsonValue, path: Array<string | number> = []) {
  const matches: Array<Array<string | number>> = [];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      matches.push(...findForbiddenStructuredFields(entry, [...path, index]));
    });
    return matches;
  }

  if (typeof value !== "object" || value === null) {
    return matches;
  }

  for (const [key, entry] of Object.entries(value)) {
    const keyPath = [...path, key];

    if (forbiddenStructuredKeys.has(normalizeStructuredKey(key))) {
      matches.push(keyPath);
    }

    if (normalizeStructuredKey(key) === "env" && typeof entry === "object" && entry !== null) {
      for (const envKey of Object.keys(entry)) {
        if (envKey.toUpperCase().includes("RUNNER_API_KEY")) {
          matches.push([...keyPath, envKey]);
        }
      }
    }

    matches.push(...findForbiddenStructuredFields(entry, keyPath));
  }

  return matches;
}
