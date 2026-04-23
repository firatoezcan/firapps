import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRunnerSecretPreview,
  createRunnerApiKey,
  createRunnerJobSchema,
  createRunnerSessionSchema,
  expiredRunnerLeaseDisposition,
  hashRunnerSecret,
  runnerJobCancellationResponse,
  runnerJobLeaseMutationAllowed,
  runnerProtocolVersion,
} from "./runner-control-plane.js";

void test("runner API keys are represented by hashes and previews", () => {
  const apiKey = createRunnerApiKey();
  const hash = hashRunnerSecret(apiKey);
  const preview = buildRunnerSecretPreview(apiKey);

  assert.match(apiKey, /^frp_/);
  assert.notEqual(hash, apiKey);
  assert.equal(hash, hashRunnerSecret(apiKey));
  assert.ok(preview.startsWith("frp_"));
  assert.ok(!preview.includes(apiKey.slice(8, -6)));
});

void test("runner sessions reject unsupported protocol versions", () => {
  const result = createRunnerSessionSchema.safeParse({
    protocolVersion: "unknown-runner-v0",
  });

  assert.equal(result.success, false);
});

void test("runner session payload uses bearer API key outside the JSON body", () => {
  const valid = createRunnerSessionSchema.safeParse({
    hostCapabilities: {
      dockerReady: true,
      maxConcurrency: 1,
      runnerName: "local-runner",
    },
    protocolVersion: runnerProtocolVersion,
  });
  const bodyKey = createRunnerSessionSchema.safeParse({
    apiKey: createRunnerApiKey(),
    protocolVersion: runnerProtocolVersion,
  });

  assert.equal(valid.success, true);
  assert.equal(bodyKey.success, false);
});

void test("runner jobs accept only known structured operations", () => {
  const valid = createRunnerJobSchema.safeParse({
    operation: "agent.forward_message",
    params: {
      content: "Implement the described repository task.",
      messageId: "msg-1",
      metadata: {
        source: "test",
      },
      taskId: "task-1",
    },
    tenantId: "00000000-0000-4000-8000-000000000001",
  });
  const unknownOperation = createRunnerJobSchema.safeParse({
    operation: "shell.exec",
    params: {},
    tenantId: "00000000-0000-4000-8000-000000000001",
  });
  const shellField = createRunnerJobSchema.safeParse({
    operation: "agent.forward_message",
    params: {
      shell: "rm -rf /",
    },
    tenantId: "00000000-0000-4000-8000-000000000001",
  });
  const argvField = createRunnerJobSchema.safeParse({
    operation: "container.start",
    params: {
      argv: ["sh", "-c", "echo nope"],
      imageRef: "ghcr.io/firatoezcan/example-task@sha256:abc",
    },
    tenantId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(valid.success, true);
  assert.equal(unknownOperation.success, false);
  assert.equal(shellField.success, false);
  assert.equal(argvField.success, false);
});

void test("runner branch and PR jobs validate the daemon's structured payload shapes", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const repositoryUrl = "https://github.com/acme/demo.git";

  const prepare = createRunnerJobSchema.safeParse({
    operation: "repo.prepare",
    params: {
      branch: "firapps/runner-20",
      checkoutId: "checkout-1",
      ref: "main",
      repositoryUrl,
    },
    tenantId,
  });
  const push = createRunnerJobSchema.safeParse({
    operation: "git.push",
    params: {
      branch: "firapps/runner-20",
      checkoutId: "checkout-1",
      repositoryUrl,
    },
    tenantId,
  });
  const pullRequest = createRunnerJobSchema.safeParse({
    operation: "github.create_pr",
    params: {
      base: "main",
      body: "Backend runner support verification.",
      branch: "firapps/runner-20",
      draft: true,
      owner: "acme",
      repo: "demo",
      title: "Add runner support",
    },
    tenantId,
  });
  const embeddedCredential = createRunnerJobSchema.safeParse({
    operation: "repo.prepare",
    params: {
      ref: "main",
      repositoryUrl: "https://token@example.com/acme/demo.git",
    },
    tenantId,
  });
  const fullRefBranch = createRunnerJobSchema.safeParse({
    operation: "github.create_pr",
    params: {
      base: "main",
      branch: "refs/heads/firapps/runner-20",
      owner: "acme",
      repo: "demo",
      title: "Add runner support",
    },
    tenantId,
  });
  const missingCheckout = createRunnerJobSchema.safeParse({
    operation: "git.push",
    params: {
      branch: "firapps/runner-20",
      repositoryUrl,
    },
    tenantId,
  });

  assert.equal(prepare.success, true);
  assert.equal(push.success, true);
  assert.equal(pullRequest.success, true);
  assert.equal(embeddedCredential.success, false);
  assert.equal(fullRefBranch.success, false);
  assert.equal(missingCheckout.success, false);
});

void test("runner cancellation polling response is explicit for requested cancellation", () => {
  assert.deepEqual(
    runnerJobCancellationResponse({
      failureMessage: null,
      status: "running",
    }),
    {
      cancelled: false,
      job: {
        status: "running",
      },
      reason: undefined,
    },
  );
  assert.deepEqual(
    runnerJobCancellationResponse({
      failureMessage: "operator requested cancellation",
      status: "cancelling",
    }),
    {
      cancelled: true,
      job: {
        status: "cancelling",
      },
      reason: "operator requested cancellation",
    },
  );
});

void test("runner lease expiry helper distinguishes requeue, cancellation, and terminal jobs", () => {
  const now = new Date("2026-04-23T12:00:00.000Z");
  const past = new Date("2026-04-23T11:59:59.000Z");
  const future = new Date("2026-04-23T12:05:00.000Z");

  assert.equal(
    expiredRunnerLeaseDisposition({ leaseExpiresAt: past, status: "leased" }, now),
    "requeue",
  );
  assert.equal(
    expiredRunnerLeaseDisposition({ leaseExpiresAt: past, status: "cancelling" }, now),
    "cancel",
  );
  assert.equal(
    expiredRunnerLeaseDisposition({ leaseExpiresAt: past, status: "completed" }, now),
    "none",
  );
  assert.equal(
    expiredRunnerLeaseDisposition({ leaseExpiresAt: future, status: "running" }, now),
    "none",
  );
  assert.equal(
    runnerJobLeaseMutationAllowed({ leaseExpiresAt: future, status: "running" }, now),
    true,
  );
  assert.equal(
    runnerJobLeaseMutationAllowed({ leaseExpiresAt: past, status: "running" }, now),
    false,
  );
});
