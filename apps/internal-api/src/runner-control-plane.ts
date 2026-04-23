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

export const createRunnerJobSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(160).optional(),
    operation: runnerOperationSchema,
    params: runnerMetadataSchema.optional(),
    runId: z.string().uuid().nullable().optional(),
    runnerId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid(),
  })
  .strict();

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
        if (envKey.toUpperCase() === "FIROPS_RUNNER_API_KEY") {
          matches.push([...keyPath, envKey]);
        }
      }
    }

    matches.push(...findForbiddenStructuredFields(entry, keyPath));
  }

  return matches;
}
