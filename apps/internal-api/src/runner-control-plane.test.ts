import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRunnerSecretPreview,
  createRunnerApiKey,
  createRunnerJobSchema,
  createRunnerSessionSchema,
  hashRunnerSecret,
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
      message: "Implement the described repository task.",
      limits: {
        maxMinutes: 30,
      },
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
