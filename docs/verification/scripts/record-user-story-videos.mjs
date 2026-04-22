#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const customerBase = process.env.CUSTOMER_WEB_URL || "http://localhost:3000";
const adminBase = process.env.ADMIN_WEB_URL || "http://localhost:3001";
const mailpitBase = process.env.MAILPIT_API_URL || "http://127.0.0.1:8025/api/v1";
const dispatchWebhookSecret =
  process.env.FIRAPPS_DISPATCH_WEBHOOK_SECRET ||
  "devboxes-local-dispatch-webhook-secret-2026-04-22";
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function originsMatch(actualUrl, expectedUrl) {
  const sameHost =
    actualUrl.hostname === expectedUrl.hostname ||
    (isLoopbackHostname(actualUrl.hostname) && isLoopbackHostname(expectedUrl.hostname));

  return (
    sameHost && actualUrl.protocol === expectedUrl.protocol && actualUrl.port === expectedUrl.port
  );
}

function urlsMatch(actual, expected) {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);

    return (
      originsMatch(actualUrl, expectedUrl) &&
      actualUrl.pathname === expectedUrl.pathname &&
      actualUrl.search === expectedUrl.search &&
      actualUrl.hash === expectedUrl.hash
    );
  } catch {
    return actual === expected;
  }
}

function urlStartsWithBase(actual, base, pathPrefix) {
  try {
    const actualUrl = new URL(actual);
    const baseUrl = new URL(base);

    return originsMatch(actualUrl, baseUrl) && actualUrl.pathname.startsWith(pathPrefix);
  } catch {
    return actual.startsWith(`${base}${pathPrefix}`);
  }
}

function normalizeLoopbackUrl(actual, preferredBase) {
  try {
    const actualUrl = new URL(actual);
    const preferredUrl = new URL(preferredBase);

    if (
      originsMatch(actualUrl, preferredUrl) &&
      actualUrl.hostname !== preferredUrl.hostname &&
      isLoopbackHostname(actualUrl.hostname) &&
      isLoopbackHostname(preferredUrl.hostname)
    ) {
      actualUrl.hostname = preferredUrl.hostname;
      return actualUrl.toString();
    }
  } catch {}

  return actual;
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath) || ".";
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function waitForUrlMatch(page, expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentUrl = page.url();

    if (
      (expected instanceof RegExp && expected.test(currentUrl)) ||
      (typeof expected === "string" && urlsMatch(currentUrl, expected))
    ) {
      return currentUrl;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for URL match: ${String(expected)} (current=${page.url()})`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
}

async function waitForMessage({ to, subject, timeoutMs = 30_000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const payload = await fetchJson(`${mailpitBase}/messages`);
    const match = (payload.messages ?? []).find((message) => {
      const recipients = (message.To ?? []).map((entry) => entry.Address?.toLowerCase());
      return (
        recipients.includes(to.toLowerCase()) && String(message.Subject ?? "").includes(subject)
      );
    });

    if (match) {
      return match;
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for Mailpit message to ${to} with subject containing "${subject}"`,
  );
}

async function countMessages({ to, subject }) {
  const payload = await fetchJson(`${mailpitBase}/messages`);

  return (payload.messages ?? []).filter((message) => {
    const recipients = (message.To ?? []).map((entry) => entry.Address?.toLowerCase());
    return recipients.includes(to.toLowerCase()) && String(message.Subject ?? "").includes(subject);
  }).length;
}

async function waitForMessageCount({ minCount, timeoutMs = 30_000, to, subject }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messageCount = await countMessages({ to, subject });

    if (messageCount >= minCount) {
      return messageCount;
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for ${minCount} Mailpit messages to ${to} with subject containing "${subject}"`,
  );
}

async function getMessage(messageId) {
  return fetchJson(`${mailpitBase}/message/${messageId}`);
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/\S+/);
  assert(match, "No URL found in Mailpit message body");
  return match[0];
}

async function waitForAnyVisible(locatorFactories, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const createLocator of locatorFactories) {
      const locator = createLocator();
      if (
        (await locator.count()) > 0 &&
        (await locator
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        return locator;
      }
    }

    await sleep(1_000);
  }

  throw new Error("Timed out waiting for one of the expected UI states.");
}

async function ensureAdminOwnerSession({ organizationName, ownerEmail, ownerPassword, page }) {
  const controlPlaneHeading = () =>
    page.getByRole("heading", { name: "Project control plane" }).first();
  const sessionSummary = () => page.getByText(`Signed in as ${ownerEmail}.`).first();
  const emailField = () => page.getByLabel("Email").first();

  await waitForAnyVisible([controlPlaneHeading, sessionSummary, emailField]);

  const ownerSignedIn =
    (await controlPlaneHeading()
      .isVisible()
      .catch(() => false)) ||
    (await sessionSummary()
      .isVisible()
      .catch(() => false));

  if (!ownerSignedIn) {
    await page.getByLabel("Email").first().fill(ownerEmail);
    await page.getByLabel("Password").first().fill(ownerPassword);
    await page.getByRole("button", { exact: true, name: "Sign in" }).click();
    await waitForAnyVisible([controlPlaneHeading, sessionSummary]);
  }

  const onControlPlane = await controlPlaneHeading()
    .isVisible()
    .catch(() => false);

  if (!onControlPlane) {
    const activeOrganizationVisible = await page
      .getByText(`Active organization: ${organizationName}`)
      .first()
      .isVisible()
      .catch(() => false);

    if (!activeOrganizationVisible) {
      await page.locator(`text=${organizationName}`).first().waitFor({ timeout: 30_000 });
      await page.getByRole("button", { exact: true, name: "Set active" }).click();
      await page
        .getByText(`Active organization: ${organizationName}`)
        .first()
        .waitFor({ timeout: 30_000 });
    }

    await page.goto(`${adminBase}/control-plane`, { waitUntil: "networkidle" });
  }

  await controlPlaneHeading().waitFor({ timeout: 30_000 });
  await page.getByText(organizationName).first().waitFor({ timeout: 30_000 });
}

async function waitForRunWorkspaceSurface({ page, runTitle, timeoutMs = 180_000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const runLocator = page.getByText(runTitle).first();
    const ideLink = page.getByRole("link", { name: "Open devbox" }).first();
    const workspaceArtifact = page.getByText("Workspace ID:").first();
    const pendingWorkspace = page.getByText("Devbox IDE URL pending.").first();
    const missingWorkspace = page.getByText("No workspace was attached to this run yet.").first();

    if ((await runLocator.count()) > 0 && (await ideLink.count()) > 0) {
      return { ready: true, ideLink };
    }

    if (
      (await runLocator.count()) > 0 &&
      ((await workspaceArtifact.count()) > 0 ||
        (await pendingWorkspace.count()) > 0 ||
        (await missingWorkspace.count()) > 0)
    ) {
      return { ready: false, ideLink: null };
    }

    await page.getByRole("button", { exact: true, name: "Refresh runs" }).click();
    await sleep(1_500);
  }

  throw new Error(`Timed out waiting for run devbox access path for ${runTitle}`);
}

async function waitForPullRequestSurface({ page, projectName, timeoutMs = 300_000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const openPrLink = page.getByRole("link", { name: "Open PR" }).first();
    const projectLocator = page.getByText(projectName).first();

    if ((await openPrLink.count()) > 0) {
      await projectLocator.waitFor({ timeout: 5_000 }).catch(() => {});
      return openPrLink;
    }

    await page.reload({ waitUntil: "networkidle" });
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for pull request visibility for ${projectName}`);
}

async function waitForRunIdByTitle({ page, title, timeoutMs = 180_000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const runId = await page.evaluate(
      async ({ title }) => {
        const response = await fetch("/api/internal/runs");

        if (!response.ok) {
          throw new Error(
            `Request failed: ${response.status} ${response.statusText} for /api/internal/runs`,
          );
        }

        const payload = await response.json();
        const runs = Array.isArray(payload?.runs) ? payload.runs : [];
        const match = runs.find((run) => typeof run?.title === "string" && run.title === title);

        return typeof match?.id === "string" ? match.id : null;
      },
      { title },
    );

    if (runId) {
      return runId;
    }

    await sleep(1_500);
  }

  throw new Error(`Timed out waiting for a run id for title ${title}`);
}

async function waitForRunExecutionPatch({
  page,
  runId,
  readmeMutationMarker,
  timeoutMs = 420_000,
}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const payload = await page.evaluate(
      async ({ runId }) => {
        const response = await fetch(`/api/internal/runs/${encodeURIComponent(runId)}`);

        if (!response.ok) {
          throw new Error(
            `Request failed: ${response.status} ${response.statusText} for /api/internal/runs/${runId}`,
          );
        }

        return response.json();
      },
      { runId },
    );
    const run = payload?.run ?? null;
    const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
    const patchArtifact = artifacts.find(
      (artifact) => artifact?.artifactType === "execution_report_patch",
    );
    const branchArtifact =
      artifacts.find((artifact) => artifact?.artifactType === "workspace_branch_used") ??
      artifacts.find((artifact) => artifact?.artifactType === "workspace_branch");
    const pushStatusArtifact = artifacts.find(
      (artifact) => artifact?.artifactType === "workspace_push_status",
    );
    const patchValue = typeof patchArtifact?.value === "string" ? patchArtifact.value : null;

    if (
      patchValue &&
      patchValue.includes("README.md") &&
      patchValue.includes(readmeMutationMarker)
    ) {
      return {
        branchName: typeof branchArtifact?.value === "string" ? branchArtifact.value : null,
        patchValue,
        prUrl: typeof run?.prUrl === "string" ? run.prUrl : null,
        pushStatus: typeof pushStatusArtifact?.value === "string" ? pushStatusArtifact.value : null,
        resultSummary: typeof run?.resultSummary === "string" ? run.resultSummary : null,
      };
    }

    await sleep(2_000);
  }

  throw new Error(
    `Timed out waiting for execution patch containing README marker ${readmeMutationMarker} for run ${runId}`,
  );
}

async function waitForRunTerminalOutcome({
  page,
  runId,
  readmeMutationMarker,
  timeoutMs = 420_000,
}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const payload = await page.evaluate(
      async ({ runId }) => {
        const response = await fetch(`/api/internal/runs/${encodeURIComponent(runId)}`);

        if (!response.ok) {
          throw new Error(
            `Request failed: ${response.status} ${response.statusText} for /api/internal/runs/${runId}`,
          );
        }

        return response.json();
      },
      { runId },
    );

    const run = payload?.run ?? null;
    const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
    const patchArtifact = artifacts.find(
      (artifact) => artifact?.artifactType === "execution_report_patch",
    );
    const branchArtifact =
      artifacts.find((artifact) => artifact?.artifactType === "workspace_branch_used") ??
      artifacts.find((artifact) => artifact?.artifactType === "workspace_branch");
    const pushStatusArtifact = artifacts.find(
      (artifact) => artifact?.artifactType === "workspace_push_status",
    );
    const patchValue = typeof patchArtifact?.value === "string" ? patchArtifact.value : null;
    const baseResult = {
      branchName: typeof branchArtifact?.value === "string" ? branchArtifact.value : null,
      failureMessage: typeof run?.failureMessage === "string" ? run.failureMessage : null,
      patchValue,
      prUrl: typeof run?.prUrl === "string" ? run.prUrl : null,
      pushStatus: typeof pushStatusArtifact?.value === "string" ? pushStatusArtifact.value : null,
      resultSummary: typeof run?.resultSummary === "string" ? run.resultSummary : null,
      status: typeof run?.status === "string" ? run.status : null,
    };

    if (
      patchValue &&
      patchValue.includes("README.md") &&
      patchValue.includes(readmeMutationMarker)
    ) {
      return {
        ...baseResult,
        outcome: "patch_ready",
      };
    }

    if (baseResult.status === "failed") {
      return {
        ...baseResult,
        outcome: "failed",
      };
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for terminal outcome for run ${runId}`);
}

async function installActionCue(context) {
  await context.addInitScript(() => {
    const ensureCueApi = () => {
      const existing = globalThis.__firappsCueApi;
      if (existing?.show && existing?.hide) {
        return existing;
      }

      const root = document.createElement("div");
      root.id = "__firapps-action-cue-root";
      root.setAttribute("aria-hidden", "true");
      root.style.position = "fixed";
      root.style.inset = "0";
      root.style.pointerEvents = "none";
      root.style.zIndex = "2147483647";
      root.style.fontFamily =
        "\"IBM Plex Sans\", \"Avenir Next\", \"Segoe UI\", sans-serif";

      const box = document.createElement("div");
      box.style.position = "fixed";
      box.style.border = "4px solid #f97316";
      box.style.borderRadius = "16px";
      box.style.boxShadow = "0 0 0 9999px rgba(15, 23, 42, 0.28)";
      box.style.opacity = "0";
      box.style.transition = "opacity 120ms ease";

      const label = document.createElement("div");
      label.style.position = "fixed";
      label.style.maxWidth = "420px";
      label.style.padding = "14px 16px";
      label.style.borderRadius = "16px";
      label.style.background = "rgba(15, 23, 42, 0.92)";
      label.style.border = "2px solid rgba(248, 250, 252, 0.18)";
      label.style.color = "#f8fafc";
      label.style.boxShadow = "0 18px 48px rgba(15, 23, 42, 0.45)";
      label.style.opacity = "0";
      label.style.transition = "opacity 120ms ease";

      const badge = document.createElement("div");
      badge.textContent = "NEXT ACTION";
      badge.style.display = "inline-flex";
      badge.style.marginBottom = "8px";
      badge.style.padding = "4px 8px";
      badge.style.borderRadius = "999px";
      badge.style.background = "rgba(249, 115, 22, 0.18)";
      badge.style.color = "#fdba74";
      badge.style.fontSize = "11px";
      badge.style.fontWeight = "700";
      badge.style.letterSpacing = "0.12em";

      const title = document.createElement("div");
      title.style.fontSize = "18px";
      title.style.fontWeight = "700";
      title.style.lineHeight = "1.3";

      const detail = document.createElement("div");
      detail.style.marginTop = "6px";
      detail.style.fontSize = "13px";
      detail.style.lineHeight = "1.45";
      detail.style.color = "rgba(226, 232, 240, 0.92)";

      label.append(badge, title, detail);
      root.append(box, label);

      const ensureMounted = () => {
        if (!document.documentElement.contains(root)) {
          document.documentElement.append(root);
        }
      };

      const hide = () => {
        ensureMounted();
        box.style.opacity = "0";
        label.style.opacity = "0";
      };

      const show = ({ boxRect, detailText, titleText }) => {
        ensureMounted();
        title.textContent = titleText;
        detail.textContent = detailText || "";

        if (boxRect && typeof boxRect.x === "number") {
          const padding = 8;
          const width = Math.max(72, boxRect.width + padding * 2);
          const height = Math.max(44, boxRect.height + padding * 2);
          const left = Math.max(8, boxRect.x - padding);
          const top = Math.max(8, boxRect.y - padding);
          box.style.left = `${left}px`;
          box.style.top = `${top}px`;
          box.style.width = `${width}px`;
          box.style.height = `${height}px`;
          box.style.opacity = "1";

          const preferredTop = Math.max(12, top - 96);
          const preferredLeft = Math.min(
            Math.max(12, left),
            window.innerWidth - Math.min(420, window.innerWidth - 24) - 12,
          );
          label.style.left = `${preferredLeft}px`;
          label.style.top = `${preferredTop}px`;
        } else {
          box.style.opacity = "0";
          label.style.left = "16px";
          label.style.top = "16px";
        }

        label.style.opacity = "1";
      };

      globalThis.__firappsCueApi = { hide, show };
      return globalThis.__firappsCueApi;
    };

    ensureCueApi();
  });
}

async function hideCue(page) {
  await page
    .evaluate(() => {
      globalThis.__firappsCueApi?.hide?.();
    })
    .catch(() => {});
}

async function cueAction(page, { locator, title, detail, pauseMs = 900 }) {
  let box = null;

  if (locator) {
    await locator.waitFor({ state: "visible", timeout: 30_000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    box = await locator.boundingBox().catch(() => null);
  }

  await page.evaluate(
    ({ boxRect, detailText, titleText }) => {
      globalThis.__firappsCueApi?.show?.({ boxRect, detailText, titleText });
    },
    {
      boxRect: box,
      detailText: detail,
      titleText: title,
    },
  );
  await sleep(pauseMs);
}

async function cueAndGoto(page, url, title, detail) {
  await cueAction(page, { detail, pauseMs: 900, title });
  await page.goto(url, { waitUntil: "networkidle" });
  await hideCue(page);
}

async function cueAndReload(page, title, detail) {
  await cueAction(page, { detail, pauseMs: 900, title });
  await page.reload({ waitUntil: "networkidle" });
  await hideCue(page);
}

async function cueAndClick(page, locator, title, detail) {
  await cueAction(page, { detail, locator, title });
  await locator.click();
  await hideCue(page);
}

async function cueAndFill(page, locator, value, title, detail) {
  await cueAction(page, { detail, locator, title, pauseMs: 750 });
  await locator.fill(value);
  await hideCue(page);
}

async function cueAndSelect(page, locator, value, title, detail) {
  await cueAction(page, { detail, locator, title, pauseMs: 750 });
  await locator.selectOption(value);
  await hideCue(page);
}

async function cueFillInputByLabel(page, label, value, title, detail, nth = 0) {
  await cueAndFill(page, page.getByLabel(label).nth(nth), value, title, detail);
}

async function cueExpectInputValueByLabel(page, label, value, nth = 0) {
  await page.getByLabel(label).nth(nth).waitFor({ timeout: 30_000 });
  const actualValue = await page.getByLabel(label).nth(nth).inputValue();
  assert(
    actualValue === value,
    `Expected ${label} to equal "${value}" but received "${actualValue}"`,
  );
}

async function cueExpectSelectedOptionLabel(locator, expectedLabel) {
  await locator.waitFor({ timeout: 30_000 });
  const actualLabel = await locator.evaluate(
    (element) => element.options[element.selectedIndex]?.label ?? "",
  );
  assert(
    actualLabel === expectedLabel,
    `Expected selected option "${expectedLabel}" but received "${actualLabel}"`,
  );
}

function chapterPrefix(index) {
  return String(index).padStart(2, "0");
}

async function createRecordedActor({
  actor,
  browser,
  chapterDir,
  storageStatePath,
  viewport = { height: 960, width: 1440 },
}) {
  const rawDir = path.join(chapterDir, "raw", actor);
  await ensureDir(rawDir);

  const contextOptions = {
    recordVideo: {
      dir: rawDir,
      size: viewport,
    },
    viewport,
  };

  if (storageStatePath && (await fileExists(storageStatePath))) {
    contextOptions.storageState = storageStatePath;
  }

  const context = await browser.newContext(contextOptions);
  await installActionCue(context);
  const page = await context.newPage();

  return {
    actor,
    context,
    page,
    rawDir,
    video: page.video(),
  };
}

async function closeRecordedActor({ actorHandle, finalPath, storageStatePath }) {
  if (storageStatePath) {
    await ensureDir(path.dirname(storageStatePath));
    await actorHandle.context.storageState({ path: storageStatePath });
  }

  await actorHandle.page.close().catch(() => {});
  await actorHandle.context.close().catch(() => {});

  if (actorHandle.video) {
    await actorHandle.video.saveAs(finalPath);
  }

  await fs.rm(actorHandle.rawDir, { force: true, recursive: true }).catch(() => {});
}

function createScenario(outputRoot) {
  const runId = Date.now();
  const ownerEmail = process.env.FIRAPPS_E2E_OWNER_EMAIL || `owner.${runId}@operator.local`;
  const inviteeEmail = process.env.FIRAPPS_E2E_INVITEE_EMAIL || `invitee.${runId}@member.local`;
  const pendingInviteEmail = `pending.${runId}@member.local`;
  const ownerPassword = `OwnerPass!${runId}`;
  const inviteePassword = `InviteePass!${runId}`;
  const inviteeResetPassword = `InviteeReset!${runId}`;
  const organizationName = `Run ${runId} Org`;
  const organizationSlug = `run-${runId}-org`;
  const projectName = `Run ${runId} Project`;
  const projectSlug = `run-${runId}-project`;
  const projectDescription = `Local-first backlog automation project ${runId}`;
  const projectRepoProvider = "github";
  const projectRepoOwner = process.env.FIRAPPS_E2E_REPO_OWNER || "firatoezcan";
  const projectRepoName = process.env.FIRAPPS_E2E_REPO_NAME || "firops-test-workspace";
  const projectDefaultBranch = process.env.FIRAPPS_E2E_REPO_BRANCH || "main";
  const workspaceBillingReference = `cus-demo-${runId}`;
  const blueprintName = `Run ${runId} Blueprint`;
  const blueprintSlug = `run-${runId}-blueprint`;
  const blueprintDescription = `Dispatch blueprint ${runId}`;
  const updatedBlueprintName = `${blueprintName} Updated`;
  const updatedBlueprintSlug = `${blueprintSlug}-updated`;
  const updatedBlueprintDescription = `Updated dispatch blueprint ${runId}`;
  const runTitle = `Implement backlog item ${runId}`;
  const slackRunTitle = `Slack backlog item ${runId}`;
  const readmeMutationMarker = `firapps-e2e-run-${runId}`;
  const slackReadmeMutationMarker = `firapps-e2e-slack-${runId}`;
  const runObjective = [
    "Modify the repository root README.md inside the isolated devbox.",
    `Append a short verification section titled "Automated verification ${runId}".`,
    `Include the exact marker "${readmeMutationMarker}" on its own line.`,
    "Keep the change additive, concise, and reviewable.",
  ].join(" ");
  const slackRunObjective = [
    "Accept this simulated Slack dispatch and make a real repository change in README.md.",
    `Append a short section titled "Slack verification ${runId}".`,
    `Include the exact marker "${slackReadmeMutationMarker}" on its own line.`,
    "Keep the change additive and reviewable.",
  ].join(" ");
  const manualDevboxPackages = ["ripgrep", "jq"];
  const manualDevboxPackagesInput = manualDevboxPackages.join("\n");
  const manualDevboxPackagesText = manualDevboxPackages.join(", ");
  const invitationSubject = `Invitation to join ${organizationName}`;

  return {
    invitationSubject,
    inviteeEmail,
    inviteePassword,
    inviteeResetPassword,
    manualDevboxPackagesInput,
    manualDevboxPackagesText,
    organizationName,
    organizationSlug,
    outputRoot,
    ownerEmail,
    ownerPassword,
    pendingInviteEmail,
    projectDefaultBranch,
    projectDescription,
    projectName,
    projectRepoName,
    projectRepoOwner,
    projectRepoProvider,
    projectSlug,
    readmeMutationMarker,
    runId,
    runObjective,
    runTitle,
    slackReadmeMutationMarker,
    slackRunObjective,
    slackRunTitle,
    updatedBlueprintDescription,
    updatedBlueprintName,
    updatedBlueprintSlug,
    workspaceBillingReference,
    blueprintDescription,
    blueprintName,
    blueprintSlug,
  };
}

function createStatePaths(outputRoot) {
  return {
    fresh: path.join(outputRoot, ".state", "fresh-sign-in.json"),
    invitee: path.join(outputRoot, ".state", "invitee.json"),
    owner: path.join(outputRoot, ".state", "owner.json"),
  };
}

async function ensureChapterDir(outputRoot, index, slug) {
  const chapterDir = path.join(outputRoot, `${chapterPrefix(index)}-${slug}`);
  await ensureDir(chapterDir);
  return chapterDir;
}

function makeChapterEntry({ actors, index, slug, steps, title }) {
  return {
    actors,
    index,
    slug,
    steps,
    title,
  };
}

async function runFounderBootstrapChapter({ browser, manifest, outputRoot, scenario, statePaths }) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 1,
    slug: "owner-bootstrap-and-verification",
    steps: [
      "Owner signs up through customer-web and creates the first organization.",
      "Mailpit verification link resolves through customer-web.",
      "Founder handoff lands on the customer home and then reuses the same auth session in admin-web.",
    ],
    title: "Founder bootstrap and verification",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
  });
  const ownerPage = owner.page;

  await cueAndGoto(
    ownerPage,
    `${customerBase}/sign-up`,
    "Open founder sign-up",
    "Start the customer-web onboarding flow for the first organization owner.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Display name",
    "Owner Example",
    "Enter founder display name",
    "Use a stable founder profile for the MVP walkthrough.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Email",
    scenario.ownerEmail,
    "Enter founder email",
    "This account becomes the founder and operator session.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Password",
    scenario.ownerPassword,
    "Enter founder password",
    "Set the initial Better Auth password for the founder.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Organization name",
    scenario.organizationName,
    "Name the organization",
    "The first organization is created during sign-up.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Organization slug",
    scenario.organizationSlug,
    "Choose the organization slug",
    "Keep the slug deterministic for the verification run.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Create account" }),
    "Submit founder sign-up",
    "Create the Better Auth account and the first organization.",
  );
  await waitForUrlMatch(ownerPage, /\/verification-pending/);
  await ownerPage.locator(`text=${scenario.ownerEmail}`).first().waitFor();

  const ownerVerificationMail = await waitForMessage({
    subject: "Verify your firapps email",
    to: scenario.ownerEmail,
  });
  const ownerVerificationBody = await getMessage(ownerVerificationMail.ID);
  const ownerVerificationUrl = extractFirstUrl(ownerVerificationBody.Text);

  assert(
    urlStartsWithBase(ownerVerificationUrl, customerBase, "/post-verify"),
    `Owner verification URL was not rewritten through customer-web: ${ownerVerificationUrl}`,
  );

  await cueAndGoto(
    ownerPage,
    normalizeLoopbackUrl(ownerVerificationUrl, customerBase),
    "Follow Mailpit verification link",
    "Use the rewritten customer-web verification URL from the Better Auth email.",
  );
  await waitForUrlMatch(ownerPage, /\/sign-up-complete/);
  await ownerPage
    .getByText("Organization bootstrap complete. Continue into the customer workspace.")
    .waitFor({ timeout: 30_000 });
  await ownerPage.getByRole("link", { name: "Open founder project setup" }).waitFor({
    timeout: 30_000,
  });
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Continue to customer home" }),
    "Enter the customer workspace",
    "Finish founder onboarding and land on the member-facing home surface.",
  );
  await waitForUrlMatch(ownerPage, `${customerBase}/`);
  await ownerPage.getByText("My work hub").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Next best action").first().waitFor({ timeout: 30_000 });
  await ownerPage.locator(`text=${scenario.organizationName}`).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByRole("link", { name: "Open project setup" }).waitFor({
    timeout: 30_000,
  });

  await cueAndGoto(
    ownerPage,
    adminBase,
    "Open admin-web with the same session",
    "Prove customer-web and admin-web share the same Better Auth session on localhost.",
  );
  await ensureAdminOwnerSession({
    organizationName: scenario.organizationName,
    ownerEmail: scenario.ownerEmail,
    ownerPassword: scenario.ownerPassword,
    page: ownerPage,
  });

  const ownerVideoPath = path.join(chapterDir, "owner.webm");
  await closeRecordedActor({
    actorHandle: owner,
    finalPath: ownerVideoPath,
    storageStatePath: statePaths.owner,
  });

  chapter.actors.push({
    actor: "owner",
    path: relativeToRepo(ownerVideoPath),
  });
  manifest.chapters.push(chapter);
}

async function runOwnerAdminInviteChapter({
  browser,
  manifest,
  outputRoot,
  scenario,
  statePaths,
}) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 2,
    slug: "owner-admin-session-and-member-invite",
    steps: [
      "Owner reuses the founder session in admin-web.",
      "Owner opens the members surface and sends the first invite.",
      "Mailpit delivers a rewritten invite URL for the target organization.",
    ],
    title: "Owner admin session and member invite",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const ownerPage = owner.page;

  await cueAndGoto(
    ownerPage,
    `${adminBase}/members`,
    "Open admin members",
    "Move from founder bootstrap into organization membership management.",
  );
  await ownerPage.getByRole("heading", { name: "Members" }).waitFor({ timeout: 30_000 });
  await cueFillInputByLabel(
    ownerPage,
    "Invitee email",
    scenario.inviteeEmail,
    "Enter the first teammate email",
    "This invitation powers the member onboarding story.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Send invitation" }),
    "Send the invitation",
    "Create the pending Better Auth organization invitation.",
  );
  await ownerPage.getByText("Invitation created.").waitFor({ timeout: 30_000 });

  const inviteMail = await waitForMessage({
    subject: `Invitation to join ${scenario.organizationName}`,
    to: scenario.inviteeEmail,
  });
  const inviteMailBody = await getMessage(inviteMail.ID);
  const invitationUrl = extractFirstUrl(inviteMailBody.Text);

  assert(
    urlStartsWithBase(invitationUrl, customerBase, "/invite/"),
    `Invitation URL was not rewritten through customer-web: ${invitationUrl}`,
  );

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });

  chapter.actors.push({
    actor: "owner",
    path: relativeToRepo(path.join(chapterDir, "owner.webm")),
  });
  manifest.chapterState.invitationUrl = normalizeLoopbackUrl(invitationUrl, customerBase);
  manifest.chapters.push(chapter);
}

async function runInviteeAcceptanceChapter({
  browser,
  manifest,
  outputRoot,
  scenario,
  statePaths,
}) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 3,
    slug: "invitee-acceptance-and-password-recovery",
    steps: [
      "Invitee signs up from the invite link and verifies email through Mailpit.",
      "Invitee accepts the organization invitation.",
      "Owner confirms membership, and invitee proves password reset plus fresh sign-in.",
    ],
    title: "Invitee acceptance and password recovery",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const invitee = await createRecordedActor({
    actor: "invitee",
    browser,
    chapterDir,
  });
  const fresh = await createRecordedActor({
    actor: "fresh-sign-in",
    browser,
    chapterDir,
  });
  const ownerPage = owner.page;
  const inviteePage = invitee.page;
  const freshPage = fresh.page;
  const invitationUrl = manifest.chapterState.invitationUrl;

  assert(invitationUrl, "Missing invitation URL from the prior admin invite chapter.");

  await cueAndGoto(
    inviteePage,
    invitationUrl,
    "Open the invitation link",
    "The invitee starts from the rewritten customer-web invitation URL.",
  );
  await cueFillInputByLabel(
    inviteePage,
    "Display name",
    "Invitee Example",
    "Enter invitee display name",
    "Create the invited teammate account from the invite path.",
  );
  await cueFillInputByLabel(
    inviteePage,
    "Email",
    scenario.inviteeEmail,
    "Confirm invitee email",
    "Use the invited email on the invitation signup form.",
    1,
  );
  await cueFillInputByLabel(
    inviteePage,
    "Password",
    scenario.inviteePassword,
    "Set the invitee password",
    "Finish the invited account creation step.",
    1,
  );
  await cueAndClick(
    inviteePage,
    inviteePage.getByRole("button", { name: "Create account" }),
    "Create the invited account",
    "Submit the invited member signup flow.",
  );
  await waitForUrlMatch(inviteePage, /\/verification-pending/);
  await inviteePage.locator(`text=${scenario.inviteeEmail}`).first().waitFor();

  const inviteeVerificationMail = await waitForMessage({
    subject: "Verify your firapps email",
    to: scenario.inviteeEmail,
  });
  const inviteeVerificationBody = await getMessage(inviteeVerificationMail.ID);
  const inviteeVerificationUrl = extractFirstUrl(inviteeVerificationBody.Text);

  assert(
    urlStartsWithBase(inviteeVerificationUrl, customerBase, "/post-verify"),
    `Invitee verification URL was not rewritten through customer-web: ${inviteeVerificationUrl}`,
  );

  await cueAndGoto(
    inviteePage,
    normalizeLoopbackUrl(inviteeVerificationUrl, customerBase),
    "Verify the invitee email",
    "The invitee follows the Better Auth verification email through customer-web.",
  );
  await waitForUrlMatch(inviteePage, /\/invite\//);

  await cueAndGoto(
    inviteePage,
    invitationUrl,
    "Return to the invitation",
    "The account is verified, so the invite can now be accepted.",
  );
  await inviteePage.getByText("Invitation state").waitFor({ timeout: 30_000 });
  await cueAndClick(
    inviteePage,
    inviteePage.getByRole("button", { name: "Accept invitation" }),
    "Accept the organization invite",
    "Activate the invited member inside the founder's organization.",
  );
  await inviteePage
    .getByText("Invitation accepted. The organization is now active on your session.")
    .waitFor({ timeout: 30_000 });

  await cueAndGoto(
    ownerPage,
    `${adminBase}/members`,
    "Confirm the accepted member in admin-web",
    "The founder verifies the new member is visible in the members inventory.",
  );
  await ownerPage.getByRole("heading", { name: "Members" }).waitFor({ timeout: 30_000 });
  await ownerPage.locator(`text=${scenario.inviteeEmail}`).first().waitFor({ timeout: 30_000 });

  await cueAndGoto(
    inviteePage,
    `${customerBase}/forgot-password`,
    "Open forgot password",
    "Prove the invitee can recover access through Better Auth email reset.",
  );
  await cueFillInputByLabel(
    inviteePage,
    "Email",
    scenario.inviteeEmail,
    "Request the reset email",
    "Use the invitee account to trigger the password reset flow.",
  );
  await cueAndClick(
    inviteePage,
    inviteePage.getByRole("button", { name: "Send reset email" }),
    "Send the reset email",
    "Mailpit should receive a customer-web reset link for the invitee.",
  );
  await inviteePage
    .getByText("Password reset email sent to Mailpit if the account exists.")
    .waitFor({ timeout: 30_000 });

  const resetMail = await waitForMessage({
    subject: "Reset your firapps password",
    to: scenario.inviteeEmail,
  });
  const resetMailBody = await getMessage(resetMail.ID);
  const resetUrl = extractFirstUrl(resetMailBody.Text);

  assert(
    urlStartsWithBase(resetUrl, customerBase, "/reset-password"),
    `Reset URL was not rewritten through customer-web: ${resetUrl}`,
  );

  await cueAndGoto(
    inviteePage,
    normalizeLoopbackUrl(resetUrl, customerBase),
    "Open the reset-password link",
    "Follow the Better Auth password reset URL from Mailpit.",
  );
  await cueFillInputByLabel(
    inviteePage,
    "New password",
    scenario.inviteeResetPassword,
    "Enter the new invitee password",
    "Set the password that the fresh browser context will reuse next.",
  );
  await cueFillInputByLabel(
    inviteePage,
    "Confirm password",
    scenario.inviteeResetPassword,
    "Confirm the new invitee password",
    "Finish the password recovery flow cleanly.",
  );
  await cueAndClick(
    inviteePage,
    inviteePage.getByRole("button", { name: "Reset password" }),
    "Submit the reset password form",
    "Persist the new Better Auth password for the invitee.",
  );
  await inviteePage.getByText("Password updated. Sign in with the new password.").waitFor({
    timeout: 30_000,
  });

  await cueAndGoto(
    freshPage,
    `${customerBase}/sign-in`,
    "Open a clean sign-in page",
    "Use a fresh browser context to prove the recovered password really works.",
  );
  await cueFillInputByLabel(
    freshPage,
    "Email",
    scenario.inviteeEmail,
    "Enter invitee email",
    "Sign in from a clean browser context after the reset.",
  );
  await cueFillInputByLabel(
    freshPage,
    "Password",
    scenario.inviteeResetPassword,
    "Enter the new invitee password",
    "The reset password should now be the only valid secret.",
  );
  await cueAndClick(
    freshPage,
    freshPage.getByRole("button", { name: "Sign in" }),
    "Sign in with the recovered password",
    "Confirm the invitee can enter the product with the fresh credentials.",
  );
  await waitForUrlMatch(freshPage, `${customerBase}/`);
  await freshPage.getByText("My work hub").first().waitFor({ timeout: 30_000 });
  await freshPage.getByText("Next best action").first().waitFor({ timeout: 30_000 });

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });
  await closeRecordedActor({
    actorHandle: invitee,
    finalPath: path.join(chapterDir, "invitee.webm"),
    storageStatePath: statePaths.invitee,
  });
  await closeRecordedActor({
    actorHandle: fresh,
    finalPath: path.join(chapterDir, "fresh-sign-in.webm"),
    storageStatePath: statePaths.fresh,
  });

  chapter.actors.push(
    { actor: "owner", path: relativeToRepo(path.join(chapterDir, "owner.webm")) },
    { actor: "invitee", path: relativeToRepo(path.join(chapterDir, "invitee.webm")) },
    {
      actor: "fresh-sign-in",
      path: relativeToRepo(path.join(chapterDir, "fresh-sign-in.webm")),
    },
  );
  manifest.chapters.push(chapter);
}

async function runProjectBlueprintChapter({
  browser,
  manifest,
  outputRoot,
  scenario,
  statePaths,
}) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 4,
    slug: "project-registration-and-blueprint-setup",
    steps: [
      "Owner registers a project with a GitHub repository and billing placeholders.",
      "Owner creates an org blueprint, saves it as the project default, then proves persistence.",
      "Owner updates, archives, and reactivates the blueprint before opening the run composer with the right defaults.",
    ],
    title: "Project registration and blueprint setup",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const ownerPage = owner.page;

  await cueAndGoto(
    ownerPage,
    `${adminBase}/projects`,
    "Open admin projects",
    "Register the first project and bind it to a GitHub repository.",
  );
  await ownerPage.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 30_000 });
  await cueFillInputByLabel(
    ownerPage,
    "Project name",
    scenario.projectName,
    "Name the project",
    "Create the project record that future runs will use.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Project slug",
    scenario.projectSlug,
    "Choose the project slug",
    "Keep the project routing deterministic for the run.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Project description",
    scenario.projectDescription,
    "Describe the project",
    "This is the founder-visible project description.",
  );
  await cueExpectInputValueByLabel(ownerPage, "Repository provider", scenario.projectRepoProvider);
  await cueFillInputByLabel(
    ownerPage,
    "Repository owner",
    scenario.projectRepoOwner,
    "Enter the repository owner",
    "Use the writable GitHub fixture owner for the run.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Repository name",
    scenario.projectRepoName,
    "Enter the repository name",
    "This repo receives the automated branch and PR changes.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Default branch",
    scenario.projectDefaultBranch,
    "Set the default branch",
    "Use the writable default branch for the execution proof.",
  );
  await cueAndSelect(
    ownerPage,
    ownerPage.getByLabel("Workflow mode"),
    "blueprint",
    "Choose the workflow mode",
    "Blueprint mode is the canonical local-first MVP path.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Billing contact email",
    scenario.ownerEmail,
    "Enter the billing contact",
    "Persist the founder as the billing contact for placeholder inventory.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Billing plan",
    "growth",
    "Set the billing plan placeholder",
    "Seed the project with a founder-facing billing status.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Billing reference",
    scenario.workspaceBillingReference,
    "Enter the billing reference",
    "The billing surface will save this placeholder again later.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Create project" }),
    "Create the project",
    "Persist the project, repo contract, and billing placeholder fields.",
  );
  await ownerPage.getByText("Project created.").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.projectName).first().waitFor({ timeout: 30_000 });
  const createdProjectCard = ownerPage
    .locator("div.rounded-xl.border.p-4")
    .filter({ hasText: scenario.projectName })
    .first();
  await createdProjectCard.getByText("Dispatch readiness").waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => createdProjectCard.getByText("dispatch ready").first(),
    () => createdProjectCard.getByText("dispatch attention").first(),
    () => createdProjectCard.getByText("dispatch blocked").first(),
    () => createdProjectCard.getByText("dispatch pending").first(),
  ]);

  await cueAndGoto(
    ownerPage,
    `${adminBase}/blueprints`,
    "Open admin blueprints",
    "Create the first organization-scoped blueprint for the project.",
  );
  await ownerPage.getByRole("heading", { name: "Blueprint selection and dispatch" }).waitFor({
    timeout: 30_000,
  });
  await cueFillInputByLabel(
    ownerPage,
    "Blueprint name",
    scenario.blueprintName,
    "Name the blueprint",
    "Seed an organization-scoped blueprint that future runs can reuse.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Slug",
    scenario.blueprintSlug,
    "Choose the blueprint slug",
    "Keep the blueprint identity deterministic for the walkthrough.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Description",
    scenario.blueprintDescription,
    "Describe the blueprint",
    "Store a founder-visible blueprint description for the dispatch flow.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Create blueprint" }),
    "Create the blueprint",
    "Persist the organization-scoped blueprint definition.",
  );
  await ownerPage.getByText("Blueprint created.").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.blueprintName).first().waitFor({ timeout: 30_000 });

  await cueAndGoto(
    ownerPage,
    `${adminBase}/projects`,
    "Return to projects",
    "Save the organization blueprint as the default for the new project.",
  );
  await ownerPage.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 30_000 });
  const projectInventoryCard = ownerPage
    .locator("div.rounded-xl.border.p-4")
    .filter({ hasText: scenario.projectName })
    .first();
  const defaultBlueprintSelect = projectInventoryCard.locator("select").first();
  const defaultBlueprintLabel = `${scenario.blueprintName} (organization)`;
  await cueAndSelect(
    ownerPage,
    defaultBlueprintSelect,
    { label: defaultBlueprintLabel },
    "Choose the default blueprint",
    "Attach the org blueprint as the default dispatch path for this project.",
  );
  await cueAndClick(
    ownerPage,
    projectInventoryCard.getByRole("button", { name: "Save default" }),
    "Save the default blueprint",
    "Persist the default blueprint selection on the project card.",
  );
  await ownerPage
    .getByText(`Default Blueprint saved for ${scenario.projectName}.`)
    .waitFor({ timeout: 30_000 });
  await cueAndReload(
    ownerPage,
    "Reload the project inventory",
    "Prove the default blueprint persists across an admin page reload.",
  );
  const refreshedProjectInventoryCard = ownerPage
    .locator("div.rounded-xl.border.p-4")
    .filter({ hasText: scenario.projectName })
    .first();
  await cueExpectSelectedOptionLabel(
    refreshedProjectInventoryCard.locator("select").first(),
    defaultBlueprintLabel,
  );

  await cueAndGoto(
    ownerPage,
    `${adminBase}/blueprints`,
    "Edit the saved blueprint",
    "Update, archive, and reactivate the same organization blueprint.",
  );
  await ownerPage.getByRole("heading", { name: "Blueprint selection and dispatch" }).waitFor({
    timeout: 30_000,
  });
  await cueAndClick(
    ownerPage,
    ownerPage.locator("button").filter({ hasText: scenario.blueprintName }).first(),
    "Open the blueprint editor",
    "Select the newly created blueprint from the inventory list.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Blueprint name",
    scenario.updatedBlueprintName,
    "Rename the blueprint",
    "Update the blueprint title to prove the edit flow works.",
    1,
  );
  await cueFillInputByLabel(
    ownerPage,
    "Slug",
    scenario.updatedBlueprintSlug,
    "Update the blueprint slug",
    "Keep the edited blueprint identity aligned with the new name.",
    1,
  );
  await cueFillInputByLabel(
    ownerPage,
    "Description",
    scenario.updatedBlueprintDescription,
    "Update the blueprint description",
    "Persist a changed description in the blueprint editor.",
    1,
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Save changes" }),
    "Save the blueprint changes",
    "Persist the edited organization blueprint in admin-web.",
  );
  await ownerPage
    .getByText(`Blueprint ${scenario.updatedBlueprintName} updated.`)
    .first()
    .waitFor({ timeout: 30_000 });

  ownerPage.once("dialog", (dialog) => dialog.accept());
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Archive" }),
    "Archive the blueprint",
    "Prove the org blueprint can be soft-archived from the same editor.",
  );
  await ownerPage
    .getByText(`Blueprint ${scenario.updatedBlueprintName} archived.`)
    .first()
    .waitFor({ timeout: 30_000 });
  const archivedBlueprintRow = ownerPage
    .locator("div.rounded-xl.border.p-3")
    .filter({ hasText: scenario.updatedBlueprintName })
    .first();
  await archivedBlueprintRow.waitFor({ timeout: 30_000 });
  await cueAndClick(
    ownerPage,
    archivedBlueprintRow.getByRole("button", { name: "Reactivate" }),
    "Reactivate the archived blueprint",
    "Bring the blueprint back without leaving the current admin page.",
  );
  await ownerPage
    .getByText(`Blueprint ${scenario.updatedBlueprintName} reactivated.`)
    .first()
    .waitFor({ timeout: 30_000 });
  await cueAndSelect(
    ownerPage,
    ownerPage.getByLabel("Target project"),
    { label: `${scenario.projectName} (${scenario.projectSlug})` },
    "Choose the target project",
    "Prepare the blueprint-to-run handoff for the exact project.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("link", { name: "Open run composer" }),
    "Open the run composer",
    "Carry the selected project and blueprint into the runs surface.",
  );
  await ownerPage.getByRole("heading", { name: "Runs and results" }).waitFor({
    timeout: 30_000,
  });
  await ownerPage
    .getByText(
      `Blueprint handoff ready: ${scenario.projectName} + ${scenario.updatedBlueprintName}.`,
    )
    .waitFor({ timeout: 30_000 });
  await cueExpectSelectedOptionLabel(
    ownerPage.getByLabel("Project"),
    `${scenario.projectName} (${scenario.projectSlug})`,
  );
  await cueExpectSelectedOptionLabel(
    ownerPage.getByLabel("Blueprint"),
    `${scenario.updatedBlueprintName} (organization)`,
  );

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });

  chapter.actors.push({
    actor: "owner",
    path: relativeToRepo(path.join(chapterDir, "owner.webm")),
  });
  manifest.chapters.push(chapter);
}

async function runDispatchChapter({ browser, manifest, outputRoot, scenario, statePaths }) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 5,
    slug: "dispatch-from-product-and-sidechannel",
    steps: [
      "Owner dispatches a normal run from admin-web.",
      "Owner dispatches a second Slack-style sidechannel run from the same page.",
      "Both runs appear in the admin runs inventory.",
    ],
    title: "Dispatch from product and sidechannel",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const ownerPage = owner.page;

  await cueAndGoto(
    ownerPage,
    `${adminBase}/runs`,
    "Open admin runs",
    "Start from the run composer with the founder session already active.",
  );
  await ownerPage.getByRole("heading", { name: "Runs and results" }).waitFor({ timeout: 30_000 });
  await cueAndSelect(
    ownerPage,
    ownerPage.getByLabel("Project"),
    { label: `${scenario.projectName} (${scenario.projectSlug})` },
    "Choose the project",
    "Make sure the run is attached to the configured project.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Run title",
    scenario.runTitle,
    "Enter the main run title",
    "This run will exercise the real execution bridge and PR flow.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Objective",
    scenario.runObjective,
    "Describe the run objective",
    "The run asks the devbox to edit README.md in a reviewable way.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Dispatch run" }),
    "Dispatch the main run",
    "Submit the founder-initiated product run into the devbox pipeline.",
  );
  await ownerPage
    .getByText("Run dispatched into the isolated devbox pipeline.")
    .waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.runTitle).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Provision devbox").first().waitFor({ timeout: 30_000 });

  await cueFillInputByLabel(
    ownerPage,
    "Requester display name",
    "Owner Example",
    "Set the sidechannel requester",
    "Prepare the Slack-style dispatch lane from the same admin route.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Sidechannel channel",
    "launch-ops",
    "Set the sidechannel channel",
    "Simulate the incoming Slack or chat dispatch source.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Dispatch secret",
    dispatchWebhookSecret,
    "Enter the dispatch secret",
    "Use the local webhook secret for the sidechannel handoff.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Sidechannel title",
    scenario.slackRunTitle,
    "Enter the sidechannel title",
    "This becomes the second run created from the Slack-style flow.",
  );
  await cueFillInputByLabel(
    ownerPage,
    "Sidechannel objective",
    scenario.slackRunObjective,
    "Describe the sidechannel objective",
    "This request makes a second README mutation through the chat-style lane.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Dispatch from sidechannel" }),
    "Dispatch from the sidechannel form",
    "Submit the Slack-style run without leaving admin /runs.",
  );
  await ownerPage.getByText("Slack-style sidechannel dispatch accepted.").waitFor({
    timeout: 30_000,
  });
  await ownerPage.getByText(scenario.slackRunTitle).first().waitFor({ timeout: 30_000 });

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });

  chapter.actors.push({
    actor: "owner",
    path: relativeToRepo(path.join(chapterDir, "owner.webm")),
  });
  manifest.chapters.push(chapter);
}

async function runExecutionArtifactsChapter({
  browser,
  manifest,
  outputRoot,
  scenario,
  statePaths,
}) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 6,
    slug: "run-execution-devbox-and-pr-artifacts",
    steps: [
      "Owner waits for the run to obtain a stable id and workspace state.",
      "Owner waits for the real execution patch, branch, and push-status artifacts.",
      "If the devbox is ready, the recorded flow opens the live code-server popup.",
    ],
    title: "Run execution, devbox, and PR artifacts",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const ownerPage = owner.page;

  await cueAndGoto(
    ownerPage,
    `${adminBase}/runs`,
    "Reopen admin runs",
    "Wait for the dispatched run to produce a real execution outcome.",
  );
  await ownerPage.getByRole("heading", { name: "Runs and results" }).waitFor({ timeout: 30_000 });
  await cueAction(ownerPage, {
    detail:
      "The recorder pauses while the workspace provisions and the execution bridge pushes a branch.",
    title: "Wait for workspace and run artifacts",
  });
  const runWorkspaceSurface = await waitForRunWorkspaceSurface({
    page: ownerPage,
    runTitle: scenario.runTitle,
  });
  const dispatchedRunId = await waitForRunIdByTitle({
    page: ownerPage,
    title: scenario.runTitle,
  });
  const manualRunOutcome = await waitForRunTerminalOutcome({
    page: ownerPage,
    readmeMutationMarker: scenario.readmeMutationMarker,
    runId: dispatchedRunId,
  });
  let successfulRun = null;
  let slackRunId = null;
  let slackRunOutcome = null;

  if (manualRunOutcome.outcome === "patch_ready") {
    successfulRun = {
      ...manualRunOutcome,
      marker: scenario.readmeMutationMarker,
      runId: dispatchedRunId,
      title: scenario.runTitle,
    };
  } else {
    slackRunId = await waitForRunIdByTitle({
      page: ownerPage,
      title: scenario.slackRunTitle,
    });
    slackRunOutcome = await waitForRunTerminalOutcome({
      page: ownerPage,
      readmeMutationMarker: scenario.slackReadmeMutationMarker,
      runId: slackRunId,
    });

    if (slackRunOutcome.outcome === "patch_ready") {
      successfulRun = {
        ...slackRunOutcome,
        marker: scenario.slackReadmeMutationMarker,
        runId: slackRunId,
        title: scenario.slackRunTitle,
      };
    }
  }
  await hideCue(ownerPage);

  assert(
    successfulRun,
    [
      "Neither run produced a successful execution patch.",
      `manual_status=${manualRunOutcome.status ?? "unknown"}`,
      `manual_outcome=${manualRunOutcome.outcome ?? "unknown"}`,
      `slack_status=${slackRunOutcome?.status ?? "not_checked"}`,
      `slack_outcome=${slackRunOutcome?.outcome ?? "not_checked"}`,
    ].join(" "),
  );

  assert(
    successfulRun.pushStatus === "succeeded",
    `Successful execution did not report a successful push. actual=${successfulRun.pushStatus}`,
  );
  assert(
    successfulRun.branchName,
    "Successful execution artifacts did not expose the published workspace branch.",
  );
  assert(
    successfulRun.patchValue.includes(`+${successfulRun.marker}`),
    `Successful execution patch did not include the README marker line. marker=${successfulRun.marker}`,
  );

  if (runWorkspaceSurface.ready && runWorkspaceSurface.ideLink) {
    const ideHref = await runWorkspaceSurface.ideLink.getAttribute("href");

    assert(ideHref, "Run detail did not expose a devbox URL.");

    await cueAction(ownerPage, {
      detail: "The ready workspace should open a code-server surface in a popup window.",
      locator: runWorkspaceSurface.ideLink,
      title: "Open the live devbox",
    });
    const [idePage] = await Promise.all([
      ownerPage.waitForEvent("popup"),
      runWorkspaceSurface.ideLink.click(),
    ]);
    await hideCue(ownerPage);
    await idePage.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    assert(
      idePage.url().startsWith(ideHref),
      `Workspace IDE page did not open the expected access path. expected=${ideHref} actual=${idePage.url()}`,
    );
    await idePage.getByText("code-server").first().waitFor({ timeout: 30_000 });
    await idePage.close();
  }

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });

  chapter.actors.push({
    actor: "owner",
    path: relativeToRepo(path.join(chapterDir, "owner.webm")),
  });
  manifest.chapterState.dispatchedRunId = dispatchedRunId;
  manifest.chapterState.dispatchedRunOutcome = manualRunOutcome.outcome;
  manifest.chapterState.dispatchedRunTitle = scenario.runTitle;
  manifest.chapterState.founderRunFailureMessage = manualRunOutcome.failureMessage;
  manifest.chapterState.founderRunResultSummary = manualRunOutcome.resultSummary;
  manifest.chapterState.prRunId = successfulRun.runId;
  manifest.chapterState.prRunTitle = successfulRun.title;
  manifest.chapterState.runExecutionBranch = successfulRun.branchName;
  manifest.chapterState.runPullRequestUrl = successfulRun.prUrl;
  manifest.chapterState.runPushStatus = successfulRun.pushStatus;
  manifest.chapters.push(chapter);
}

async function runAdminOperationsChapter({
  browser,
  manifest,
  outputRoot,
  scenario,
  statePaths,
}) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 7,
    slug: "admin-operations-and-governance",
    steps: [
      "Owner creates and deletes a manual devbox.",
      "Owner resends and cancels a second pending invite.",
      "Founder-only operator access remains visible to the owner and denied to the invitee.",
    ],
    title: "Admin operations and governance",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const invitee = await createRecordedActor({
    actor: "invitee",
    browser,
    chapterDir,
    storageStatePath: statePaths.invitee,
  });
  const ownerPage = owner.page;
  const inviteePage = invitee.page;

  await cueAndGoto(
    ownerPage,
    `${adminBase}/devboxes`,
    "Open admin devboxes",
    "Exercise the manual devbox management surface for the founder.",
  );
  await ownerPage.getByRole("heading", { name: "Devboxes" }).waitFor({ timeout: 30_000 });
  await cueAndSelect(
    ownerPage,
    ownerPage.getByLabel("Project"),
    { label: `${scenario.projectName} (${scenario.projectSlug})` },
    "Choose the project for the manual devbox",
    "Attach the devbox to the project created earlier in the founder flow.",
  );
  await cueExpectInputValueByLabel(ownerPage, "Repository owner", scenario.projectRepoOwner);
  await cueExpectInputValueByLabel(ownerPage, "Repository name", scenario.projectRepoName);
  await cueFillInputByLabel(
    ownerPage,
    "Optional nix packages",
    scenario.manualDevboxPackagesInput,
    "Enter the devbox package set",
    "Seed a small devbox package list for the manual workspace path.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Create devbox" }),
    "Create the manual devbox",
    "Provision a founder-visible devbox outside the run-triggered path.",
  );
  await ownerPage.getByText("Devbox created.").waitFor({ timeout: 30_000 });
  const manualDevboxRow = ownerPage
    .locator("div.rounded-xl.border.p-4")
    .filter({ hasText: scenario.projectName })
    .filter({ hasText: scenario.manualDevboxPackagesText })
    .first();
  await manualDevboxRow.waitFor({ timeout: 30_000 });
  await cueAndClick(
    ownerPage,
    manualDevboxRow.getByRole("button", { name: "Delete devbox" }),
    "Delete the manual devbox",
    "Clean up the founder-created devbox to prove the lifecycle is reversible.",
  );
  await ownerPage
    .getByText("Devbox deleted.")
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await manualDevboxRow.waitFor({ state: "detached", timeout: 60_000 });

  await cueAndGoto(
    ownerPage,
    `${adminBase}/members`,
    "Return to members",
    "Create a second pending invite so resend and cancel are both visible.",
  );
  await ownerPage.getByRole("heading", { name: "Members" }).waitFor({ timeout: 30_000 });
  await ownerPage.locator(`text=${scenario.ownerEmail}`).first().waitFor({ timeout: 30_000 });
  await ownerPage.locator(`text=${scenario.inviteeEmail}`).first().waitFor({ timeout: 30_000 });
  await cueFillInputByLabel(
    ownerPage,
    "Invitee email",
    scenario.pendingInviteEmail,
    "Enter a second pending invite",
    "This invite remains pending so resend and cancel can be demonstrated.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Send invitation" }),
    "Create the second pending invite",
    "Persist a second invite for the admin membership operations story.",
  );
  await ownerPage.getByText("Invitation created.").waitFor({ timeout: 30_000 });
  const pendingInvitationRow = ownerPage
    .locator("div.rounded-xl.border.p-3")
    .filter({ hasText: scenario.pendingInviteEmail })
    .first();
  await pendingInvitationRow.waitFor({ timeout: 30_000 });
  const invitationMessageCount = await countMessages({
    subject: scenario.invitationSubject,
    to: scenario.pendingInviteEmail,
  });
  await cueAndClick(
    ownerPage,
    pendingInvitationRow.getByRole("button", { name: "Resend" }),
    "Resend the pending invite",
    "Verify the admin surface can resend the pending invitation email.",
  );
  await ownerPage.getByText("Invitation resent.").waitFor({ timeout: 30_000 });
  await waitForMessageCount({
    minCount: invitationMessageCount + 1,
    subject: scenario.invitationSubject,
    to: scenario.pendingInviteEmail,
  });
  await cueAndClick(
    ownerPage,
    pendingInvitationRow.getByRole("button", { name: "Cancel" }),
    "Cancel the pending invite",
    "Finish the pending invitation lifecycle without leaving the page.",
  );
  await ownerPage.getByText("Invitation cancelled.").waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => pendingInvitationRow.getByText("cancelled").first(),
    () => pendingInvitationRow.getByText("canceled").first(),
  ]);

  await cueAndGoto(
    ownerPage,
    `${adminBase}/operators`,
    "Open founder operator view",
    "Prove the founder can reach the privileged operator surface.",
  );
  await ownerPage.getByRole("heading", { name: "Operator view" }).waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.organizationName).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.runTitle).first().waitFor({ timeout: 30_000 });

  await cueAndGoto(
    inviteePage,
    adminBase,
    "Open admin-web as the invitee",
    "Use the accepted member session to inspect the admin surfaces.",
  );
  await ensureAdminOwnerSession({
    organizationName: scenario.organizationName,
    ownerEmail: scenario.inviteeEmail,
    ownerPassword: scenario.inviteeResetPassword,
    page: inviteePage,
  });
  await cueAndGoto(
    inviteePage,
    `${adminBase}/operators`,
    "Attempt founder-only operator access",
    "The invitee should be denied founder-only operator data.",
  );
  await inviteePage.getByRole("heading", { name: "Operator view" }).waitFor({ timeout: 30_000 });
  await inviteePage.getByText("Operator data unavailable").waitFor({ timeout: 30_000 });
  await inviteePage
    .getByText("Internal API denied access for the current session.")
    .waitFor({ timeout: 30_000 });

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });
  await closeRecordedActor({
    actorHandle: invitee,
    finalPath: path.join(chapterDir, "invitee.webm"),
    storageStatePath: statePaths.invitee,
  });

  chapter.actors.push(
    { actor: "owner", path: relativeToRepo(path.join(chapterDir, "owner.webm")) },
    { actor: "invitee", path: relativeToRepo(path.join(chapterDir, "invitee.webm")) },
  );
  manifest.chapters.push(chapter);
}

async function runAdminReviewChapter({ browser, manifest, outputRoot, scenario, statePaths }) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 8,
    slug: "admin-review-and-usage-surfaces",
    steps: [
      "Invitee can inspect org-level runs and pull requests in admin-web.",
      "Owner inspects control-plane, queue, PR visibility, run detail, billing, and activity.",
      "The dispatched run is visible as a real reviewable work item with billing and activity context.",
    ],
    title: "Admin review and usage surfaces",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const invitee = await createRecordedActor({
    actor: "invitee",
    browser,
    chapterDir,
    storageStatePath: statePaths.invitee,
  });
  const ownerPage = owner.page;
  const inviteePage = invitee.page;
  const dispatchedRunId = manifest.chapterState.dispatchedRunId;

  assert(dispatchedRunId, "Missing dispatched run id from the execution artifacts chapter.");

  await cueAndGoto(
    inviteePage,
    `${adminBase}/runs`,
    "Open org-level runs as the invitee",
    "Members can inspect the organization runs surface without founder-only operator access.",
  );
  await inviteePage.getByRole("heading", { name: "Runs and results" }).waitFor({
    timeout: 30_000,
  });
  await inviteePage.getByText(scenario.runTitle).first().waitFor({ timeout: 30_000 });

  await cueAndGoto(
    inviteePage,
    `${adminBase}/pull-requests`,
    "Open org-level pull requests as the invitee",
    "Members can also inspect the organization PR inventory in admin-web.",
  );
  await inviteePage.getByRole("heading", { name: "Pull request visibility" }).waitFor({
    timeout: 30_000,
  });
  await inviteePage.getByText(scenario.projectName).first().waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => inviteePage.getByRole("link", { name: "Open PR" }).first(),
    () =>
      inviteePage
        .getByText("No pull requests are visible for the active organization yet.")
        .first(),
  ]);

  await cueAndGoto(
    ownerPage,
    `${adminBase}/control-plane`,
    "Open the founder control plane",
    "Inspect the project control plane with the founder session.",
  );
  await ownerPage.getByRole("heading", { name: "Project control plane" }).waitFor({
    timeout: 30_000,
  });
  await ownerPage.getByText(scenario.projectName).first().waitFor({ timeout: 30_000 });

  await cueAndGoto(
    ownerPage,
    `${adminBase}/queue`,
    "Open the run queue",
    "Check capacity and queued work across the organization.",
  );
  await ownerPage.getByRole("heading", { name: "Run queue" }).waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Capacity snapshot").first().waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => ownerPage.getByText(scenario.runTitle).first(),
    () => ownerPage.getByText(scenario.slackRunTitle).first(),
    () =>
      ownerPage
        .getByText("No blocked, quiet, or failure-signaling runs are visible right now.")
        .first(),
  ]);

  await cueAndGoto(
    ownerPage,
    `${adminBase}/pull-requests`,
    "Open admin pull requests",
    "Wait for the execution bridge to expose the review surface in admin-web.",
  );
  await ownerPage.getByRole("heading", { name: "Pull request visibility" }).waitFor({
    timeout: 30_000,
  });
  await ownerPage.getByText("Review attention").first().waitFor({ timeout: 30_000 });
  await cueAction(ownerPage, {
    detail: "The recorder pauses until the branch and draft PR become visible in admin-web.",
    title: "Wait for PR visibility",
  });
  const openPrLink = await waitForPullRequestSurface({
    page: ownerPage,
    projectName: scenario.projectName,
  });
  await hideCue(ownerPage);
  await openPrLink.waitFor({ timeout: 30_000 });

  await cueAndGoto(
    ownerPage,
    `${adminBase}/runs/${dispatchedRunId}`,
    "Open the run detail page",
    "Inspect the dispatched run summary, artifacts, and workspace linkage in admin-web.",
  );
  await ownerPage.getByText(scenario.runTitle).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Outcome and next action").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Workspace and devbox").first().waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => ownerPage.getByRole("link", { name: "Open pull request" }).first(),
    () => ownerPage.getByText("Workspace ID:").first(),
    () => ownerPage.getByText("No workspace is attached to this run yet.").first(),
  ]);

  await cueAndGoto(
    ownerPage,
    `${adminBase}/billing`,
    "Open billing inventory",
    "Update the founder-visible billing placeholder status for the project.",
  );
  await ownerPage.getByRole("heading", { name: "Billing inventory" }).waitFor({
    timeout: 30_000,
  });
  await ownerPage.getByText(scenario.projectName).first().waitFor({ timeout: 30_000 });
  await cueExpectInputValueByLabel(
    ownerPage,
    "Billing reference",
    scenario.workspaceBillingReference,
  );
  await cueFillInputByLabel(
    ownerPage,
    "Billing status",
    "watch",
    "Update the billing status placeholder",
    "Persist a founder-facing billing placeholder for the project.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Save billing" }),
    "Save the billing placeholder",
    "Keep the billing inventory up to date in the admin surface.",
  );
  await ownerPage
    .getByText(`Billing placeholders saved for ${scenario.projectName}.`)
    .waitFor({ timeout: 30_000 });
  await cueExpectInputValueByLabel(ownerPage, "Billing status", "watch");

  await cueAndGoto(
    ownerPage,
    `${adminBase}/activity`,
    "Open the activity feed",
    "Check the organization-level activity surface after project and run events.",
  );
  await ownerPage.getByRole("heading", { name: "Activity" }).waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => ownerPage.getByText(scenario.runTitle).first(),
    () => ownerPage.getByText(scenario.projectName).first(),
    () =>
      ownerPage
        .getByText(
          "No recent project, run, or workspace events are visible for the active organization.",
        )
        .first(),
  ]);

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });
  await closeRecordedActor({
    actorHandle: invitee,
    finalPath: path.join(chapterDir, "invitee.webm"),
    storageStatePath: statePaths.invitee,
  });

  chapter.actors.push(
    { actor: "owner", path: relativeToRepo(path.join(chapterDir, "owner.webm")) },
    { actor: "invitee", path: relativeToRepo(path.join(chapterDir, "invitee.webm")) },
  );
  manifest.chapters.push(chapter);
}

async function runCustomerWorkChapter({ browser, manifest, outputRoot, scenario, statePaths }) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 9,
    slug: "customer-owner-work-surfaces",
    steps: [
      "Owner inspects customer-web runs, run detail, pull requests, organization, and account.",
      "The member-facing surfaces reflect the founder's actual work and org state.",
      "Run detail and PR visibility stay aligned with the backend member-scoped filters.",
    ],
    title: "Customer owner work surfaces",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const ownerPage = owner.page;
  const dispatchedRunId = manifest.chapterState.dispatchedRunId;

  assert(dispatchedRunId, "Missing dispatched run id from the execution artifacts chapter.");

  await cueAndGoto(
    ownerPage,
    `${customerBase}/runs`,
    "Open customer runs",
    "Inspect the founder's member-scoped run inventory in customer-web.",
  );
  await ownerPage.getByRole("heading", { name: "My runs" }).waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Next action").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("requestedBy=self").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.runTitle).first().waitFor({ timeout: 30_000 });

  await cueAndGoto(
    ownerPage,
    `${customerBase}/runs/${dispatchedRunId}`,
    "Open the customer run detail",
    "The founder sees the same run outcome and workspace surface in customer-web.",
  );
  await ownerPage.getByText(scenario.runTitle).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Outcome and next action").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("requestedBy=self").first().waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => ownerPage.getByRole("link", { name: "Open pull request" }).first(),
    () => ownerPage.getByText("Workspace ID:").first(),
    () => ownerPage.getByText("No workspace is attached to this run yet.").first(),
  ]);

  await cueAndGoto(
    ownerPage,
    `${customerBase}/pull-requests`,
    "Open customer pull requests",
    "Inspect the founder's member-scoped PR inventory in customer-web.",
  );
  await ownerPage.getByRole("heading", { name: "My pull requests" }).waitFor({
    timeout: 30_000,
  });
  await ownerPage.getByText("Next action").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("requestedBy=self").first().waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => ownerPage.getByRole("link", { name: "Open PR" }).first(),
    () =>
      ownerPage.getByText("No member-scoped run exposes a pull request URL right now.").first(),
  ]);

  await cueAndGoto(
    ownerPage,
    `${customerBase}/organization`,
    "Open the organization summary",
    "Inspect the organization view from the customer-facing product surface.",
  );
  await ownerPage.getByRole("heading", { exact: true, name: "Organization" }).waitFor({
    timeout: 30_000,
  });
  await ownerPage.getByText(scenario.organizationName).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.projectName).first().waitFor({ timeout: 30_000 });

  await cueAndGoto(
    ownerPage,
    `${customerBase}/account`,
    "Open the founder account view",
    "Inspect the founder account details from customer-web.",
  );
  await ownerPage.getByRole("heading", { exact: true, name: "Account" }).waitFor({
    timeout: 30_000,
  });
  await ownerPage.getByText(scenario.ownerEmail).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.organizationName).first().waitFor({ timeout: 30_000 });

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });

  chapter.actors.push({
    actor: "owner",
    path: relativeToRepo(path.join(chapterDir, "owner.webm")),
  });
  manifest.chapters.push(chapter);
}

async function runCustomerMemberScopeChapter({
  browser,
  manifest,
  outputRoot,
  scenario,
  statePaths,
}) {
  const chapter = makeChapterEntry({
    actors: [],
    index: 10,
    slug: "customer-member-scope-and-home-summary",
    steps: [
      "Invitee sees invitations and member-scoped customer routes without access to the owner's run or PR detail.",
      "Owner refreshes the customer home summary after the full workflow.",
      "The final member dashboard shows project, run, and devbox visibility without leaking work to the invitee.",
    ],
    title: "Customer member scope and home summary",
  });
  const chapterDir = await ensureChapterDir(outputRoot, chapter.index, chapter.slug);
  const owner = await createRecordedActor({
    actor: "owner",
    browser,
    chapterDir,
    storageStatePath: statePaths.owner,
  });
  const invitee = await createRecordedActor({
    actor: "invitee",
    browser,
    chapterDir,
    storageStatePath: statePaths.invitee,
  });
  const ownerPage = owner.page;
  const inviteePage = invitee.page;

  await cueAndGoto(
    inviteePage,
    `${customerBase}/invitations`,
    "Open invitee invitations",
    "Inspect the invitee-facing invitation records in customer-web.",
  );
  await inviteePage.getByRole("heading", { name: "Invitations" }).waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => inviteePage.getByText(scenario.organizationName).first(),
    () =>
      inviteePage
        .getByText("No invitation records are visible for this account right now.")
        .first(),
  ]);

  await cueAndGoto(
    inviteePage,
    `${customerBase}/runs`,
    "Open invitee runs",
    "The invitee should not receive detail links for the owner's member-scoped runs.",
  );
  await inviteePage.getByRole("heading", { name: "My runs" }).waitFor({ timeout: 30_000 });
  await inviteePage.getByText("requestedBy=self").first().waitFor({ timeout: 30_000 });
  await inviteePage
    .getByText("No member-scoped runs are visible for the active organization yet.")
    .waitFor({ timeout: 30_000 });
  assert(
    (await inviteePage.getByRole("link", { name: "Open detail page" }).count()) === 0,
    "Invitee unexpectedly received run detail links for another member's work.",
  );

  await cueAndGoto(
    inviteePage,
    `${customerBase}/pull-requests`,
    "Open invitee pull requests",
    "The invitee should not receive PR links for another member's work.",
  );
  await inviteePage.getByRole("heading", { name: "My pull requests" }).waitFor({
    timeout: 30_000,
  });
  await inviteePage
    .getByText("No member-scoped run exposes a pull request URL right now.")
    .waitFor({ timeout: 30_000 });
  assert(
    (await inviteePage.getByRole("link", { name: "Open PR" }).count()) === 0,
    "Invitee unexpectedly received PR links for another member's work.",
  );

  await cueAndGoto(
    ownerPage,
    `${customerBase}/`,
    "Return to the founder home summary",
    "Finish on the customer home with the founder's project, run, and devbox summary visible.",
  );
  await cueAndClick(
    ownerPage,
    ownerPage.getByRole("button", { name: "Refresh customer workspace" }),
    "Refresh the founder home dashboard",
    "Pull the final workspace, run, and project state into the customer home surface.",
  );
  await ownerPage.getByText("My work hub").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText("Next best action").first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.projectName).first().waitFor({ timeout: 30_000 });
  await ownerPage.getByText(scenario.runTitle).first().waitFor({ timeout: 30_000 });
  await waitForAnyVisible([
    () => ownerPage.getByRole("link", { name: "Open devbox" }).first(),
    () =>
      ownerPage
        .getByText("Access links appear here once the workspace reaches a ready state.")
        .first(),
    () =>
      ownerPage
        .getByText(
          "No active devboxes yet. They will appear here after a run provisions a workspace.",
        )
        .first(),
  ]);

  await closeRecordedActor({
    actorHandle: owner,
    finalPath: path.join(chapterDir, "owner.webm"),
    storageStatePath: statePaths.owner,
  });
  await closeRecordedActor({
    actorHandle: invitee,
    finalPath: path.join(chapterDir, "invitee.webm"),
    storageStatePath: statePaths.invitee,
  });

  chapter.actors.push(
    { actor: "owner", path: relativeToRepo(path.join(chapterDir, "owner.webm")) },
    { actor: "invitee", path: relativeToRepo(path.join(chapterDir, "invitee.webm")) },
  );
  manifest.chapters.push(chapter);
}

async function writeManifestFiles(manifest) {
  const manifestPath = path.join(manifest.outputRoot, "manifest.json");
  const readmePath = path.join(manifest.outputRoot, "README.md");

  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        outputRoot: relativeToRepo(manifest.outputRoot),
      },
      null,
      2,
    )}\n`,
  );

  const lines = [
    "# User Story Videos",
    "",
    `Generated at: ${new Date(manifest.generatedAt).toISOString()}`,
    `Customer base: ${customerBase}`,
    `Admin base: ${adminBase}`,
    `Mailpit base: ${mailpitBase}`,
    "",
    "## Credentials",
    "",
    `- founder email: \`${manifest.ownerEmail}\``,
    `- founder password: \`${manifest.ownerPassword}\``,
    `- invitee email: \`${manifest.inviteeEmail}\``,
    `- invitee initial password: \`${manifest.inviteePassword}\``,
    `- invitee reset password: \`${manifest.inviteeResetPassword}\``,
    "",
    "## Fixture",
    "",
    `- organization: \`${manifest.organizationName}\``,
    `- project: \`${manifest.projectName}\``,
    `- repository: \`${manifest.projectRepoOwner}/${manifest.projectRepoName}@${manifest.projectDefaultBranch}\``,
    "",
    "## Chapters",
    "",
  ];

  for (const chapter of manifest.chapters) {
    lines.push(`### ${chapterPrefix(chapter.index)}. ${chapter.title}`);
    lines.push("");
    for (const step of chapter.steps) {
      lines.push(`- ${step}`);
    }
    for (const actor of chapter.actors) {
      const relativeVideoPath = path.relative(manifest.outputRoot, path.resolve(repoRoot, actor.path));
      lines.push(`- ${actor.actor} video: [${relativeVideoPath}](${relativeVideoPath})`);
    }
    lines.push("");
  }

  if (manifest.chapterState.dispatchedRunId) {
    lines.push("## Runtime artifacts");
    lines.push("");
    lines.push(`- dispatched run id: \`${manifest.chapterState.dispatchedRunId}\``);
    if (manifest.chapterState.runExecutionBranch) {
      lines.push(`- published branch: \`${manifest.chapterState.runExecutionBranch}\``);
    }
    if (manifest.chapterState.runPushStatus) {
      lines.push(`- push status: \`${manifest.chapterState.runPushStatus}\``);
    }
    if (manifest.chapterState.runPullRequestUrl) {
      lines.push(`- pull request URL: ${manifest.chapterState.runPullRequestUrl}`);
    }
    lines.push("");
  }

  await fs.writeFile(readmePath, `${lines.join("\n")}\n`);
}

async function main() {
  const runId = Date.now();
  const outputRoot = path.resolve(
    process.env.FIRAPPS_STORY_VIDEO_DIR ||
      path.join(repoRoot, "state", "verification", "story-videos", `run-${runId}`),
  );
  const scenario = createScenario(outputRoot);
  const statePaths = createStatePaths(outputRoot);
  const manifest = {
    chapterState: {},
    chapters: [],
    generatedAt: new Date().toISOString(),
    inviteeEmail: scenario.inviteeEmail,
    inviteeInitialPassword: scenario.inviteePassword,
    inviteePassword: scenario.inviteePassword,
    inviteeResetPassword: scenario.inviteeResetPassword,
    organizationName: scenario.organizationName,
    outputRoot,
    ownerEmail: scenario.ownerEmail,
    ownerPassword: scenario.ownerPassword,
    projectDefaultBranch: scenario.projectDefaultBranch,
    projectName: scenario.projectName,
    projectRepoName: scenario.projectRepoName,
    projectRepoOwner: scenario.projectRepoOwner,
  };

  await ensureDir(outputRoot);
  await ensureDir(path.dirname(statePaths.owner));

  console.log(`storyVideoDir=${outputRoot}`);
  console.log(`ownerEmail=${scenario.ownerEmail}`);
  console.log(`inviteeEmail=${scenario.inviteeEmail}`);
  console.log(`pendingInviteEmail=${scenario.pendingInviteEmail}`);
  console.log(
    `projectRepo=${scenario.projectRepoOwner}/${scenario.projectRepoName}@${scenario.projectDefaultBranch}`,
  );

  const browser = await chromium.launch({ headless: true });

  try {
    await runFounderBootstrapChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runOwnerAdminInviteChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runInviteeAcceptanceChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runProjectBlueprintChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runDispatchChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runExecutionArtifactsChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runAdminOperationsChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runAdminReviewChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runCustomerWorkChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await runCustomerMemberScopeChapter({ browser, manifest, outputRoot, scenario, statePaths });
    await writeManifestFiles(manifest);
    console.log(`storyVideoReadme=${path.join(outputRoot, "README.md")}`);
    console.log("PLAYWRIGHT_USER_STORY_VIDEO_OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
