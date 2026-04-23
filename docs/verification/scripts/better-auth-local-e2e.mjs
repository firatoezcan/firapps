#!/usr/bin/env node

import { chromium } from "@playwright/test";

const customerBase = process.env.CUSTOMER_WEB_URL || "http://localhost:3000";
const adminBase = process.env.ADMIN_WEB_URL || "http://localhost:3001";
const mailpitBase = process.env.MAILPIT_API_URL || "http://127.0.0.1:8025/api/v1";
const dispatchWebhookSecret =
  process.env.FIRAPPS_DISPATCH_WEBHOOK_SECRET ||
  "devboxes-local-dispatch-webhook-secret-2026-04-22";

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

async function getMessage(messageId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `${mailpitBase}/message/${messageId}`;

  while (Date.now() < deadline) {
    const response = await fetch(url);

    if (response.ok) {
      return response.json();
    }

    if (response.status !== 404) {
      throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Mailpit message payload at ${url}`);
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/\S+/);
  assert(match, "No URL found in Mailpit message body");
  return match[0];
}

async function fillInputByLabel(page, label, value, nth = 0) {
  await page.getByLabel(label).nth(nth).fill(value);
}

async function expectInputValueByLabel(page, label, value, nth = 0) {
  await page.getByLabel(label).nth(nth).waitFor({ timeout: 30_000 });
  const actualValue = await page.getByLabel(label).nth(nth).inputValue();
  assert(
    actualValue === value,
    `Expected ${label} to equal "${value}" but received "${actualValue}"`,
  );
}

async function expectSelectedOptionLabel(locator, expectedLabel) {
  await locator.waitFor({ timeout: 30_000 });
  const actualLabel = await locator.evaluate(
    (element) => element.options[element.selectedIndex]?.label ?? "",
  );
  assert(
    actualLabel === expectedLabel,
    `Expected selected option "${expectedLabel}" but received "${actualLabel}"`,
  );
}

async function clickButtonByExactName(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
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
  const projectsHeading = () => page.getByRole("heading", { name: "Projects" }).first();
  const sessionSummary = () => page.getByText(`Signed in as ${ownerEmail}.`).first();
  const emailField = () => page.getByLabel("Email").first();

  await waitForAnyVisible([controlPlaneHeading, projectsHeading, sessionSummary, emailField]);

  const ownerSignedIn =
    (await controlPlaneHeading()
      .isVisible()
      .catch(() => false)) ||
    (await projectsHeading()
      .isVisible()
      .catch(() => false)) ||
    (await sessionSummary()
      .isVisible()
      .catch(() => false));

  if (!ownerSignedIn) {
    await fillInputByLabel(page, "Email", ownerEmail);
    await fillInputByLabel(page, "Password", ownerPassword);
    await clickButtonByExactName(page, "Sign in");

    await waitForAnyVisible([controlPlaneHeading, sessionSummary]);
  }

  const onControlPlane = await controlPlaneHeading()
    .isVisible()
    .catch(() => false);

  if (!onControlPlane) {
    await page.goto(`${adminBase}/control-plane`, { waitUntil: "networkidle" });
    const controlPlaneVisible = await controlPlaneHeading()
      .isVisible()
      .catch(() => false);

    if (!controlPlaneVisible) {
      const activeOrganizationVisible = await page
        .getByText(`Active organization: ${organizationName}`)
        .first()
        .isVisible()
        .catch(() => false);

      if (!activeOrganizationVisible) {
        await page.locator(`text=${organizationName}`).first().waitFor({ timeout: 30_000 });
        await clickButtonByExactName(page, "Set active");
        await page
          .getByText(`Active organization: ${organizationName}`)
          .first()
          .waitFor({ timeout: 30_000 });
      }

      await page.goto(`${adminBase}/control-plane`, { waitUntil: "networkidle" });
    }
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

    await clickButtonByExactName(page, "Refresh runs");
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

async function main() {
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

  console.log(`ownerEmail=${ownerEmail}`);
  console.log(`inviteeEmail=${inviteeEmail}`);
  console.log(`pendingInviteEmail=${pendingInviteEmail}`);
  console.log(`projectRepo=${projectRepoOwner}/${projectRepoName}@${projectDefaultBranch}`);

  const browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const freshSignInContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const inviteePage = await inviteeContext.newPage();
  const freshSignInPage = await freshSignInContext.newPage();

  try {
    await ownerPage.goto(`${customerBase}/sign-up`, { waitUntil: "networkidle" });
    await fillInputByLabel(ownerPage, "Display name", "Owner Example");
    await fillInputByLabel(ownerPage, "Email", ownerEmail);
    await fillInputByLabel(ownerPage, "Password", ownerPassword);
    await fillInputByLabel(ownerPage, "Organization name", organizationName);
    await fillInputByLabel(ownerPage, "Organization slug", organizationSlug);
    await ownerPage.getByRole("button", { name: "Create account" }).click();
    await waitForUrlMatch(ownerPage, /\/verification-pending/);
    await ownerPage.locator(`text=${ownerEmail}`).first().waitFor();

    const ownerVerificationMail = await waitForMessage({
      to: ownerEmail,
      subject: "Verify your firapps email",
    });
    const ownerVerificationBody = await getMessage(ownerVerificationMail.ID);
    const ownerVerificationUrl = extractFirstUrl(ownerVerificationBody.Text);

    assert(
      urlStartsWithBase(ownerVerificationUrl, customerBase, "/post-verify"),
      `Owner verification URL was not rewritten through customer-web: ${ownerVerificationUrl}`,
    );

    console.log(`ownerVerificationUrl=${ownerVerificationUrl}`);

    await ownerPage.goto(normalizeLoopbackUrl(ownerVerificationUrl, customerBase), {
      waitUntil: "networkidle",
    });
    await waitForUrlMatch(ownerPage, /\/sign-up-complete/);
    await ownerPage
      .getByText("Organization bootstrap complete. Continue into the customer workspace.")
      .waitFor({ timeout: 30_000 });
    const founderProjectSetupLink = ownerPage.getByRole("link", {
      name: "Open founder project setup",
    });
    await founderProjectSetupLink.waitFor({
      timeout: 30_000,
    });
    const founderProjectSetupHref = await founderProjectSetupLink.getAttribute("href");
    assert(
      founderProjectSetupHref === `${adminBase}/projects`,
      `Founder project setup link resolved to ${founderProjectSetupHref} instead of ${adminBase}/projects`,
    );
    await ownerPage.getByRole("button", { name: "Continue to customer home" }).click();
    await waitForUrlMatch(ownerPage, `${customerBase}/`);
    await ownerPage.getByText("My work hub").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("Next best action").first().waitFor({ timeout: 30_000 });
    await ownerPage.locator(`text=${organizationName}`).first().waitFor({ timeout: 30_000 });
    const customerProjectSetupLink = ownerPage.getByRole("link", { name: "Open project setup" });
    await customerProjectSetupLink.waitFor({
      timeout: 30_000,
    });
    const customerProjectSetupHref = await customerProjectSetupLink.getAttribute("href");
    assert(
      customerProjectSetupHref === `${adminBase}/projects`,
      `Customer project setup link resolved to ${customerProjectSetupHref} instead of ${adminBase}/projects`,
    );
    await ownerPage.goto(`${adminBase}/projects`, { waitUntil: "networkidle" });
    await ensureAdminOwnerSession({
      organizationName,
      ownerEmail,
      ownerPassword,
      page: ownerPage,
    });
    await ownerPage.goto(`${adminBase}/members`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Members" }).waitFor({
      timeout: 30_000,
    });
    await fillInputByLabel(ownerPage, "Invitee email", inviteeEmail);
    await ownerPage.getByRole("button", { name: "Send invitation" }).click();
    await ownerPage.getByText("Invitation created.").waitFor({ timeout: 30_000 });

    const inviteMail = await waitForMessage({
      to: inviteeEmail,
      subject: `Invitation to join ${organizationName}`,
    });
    const inviteMailBody = await getMessage(inviteMail.ID);
    const invitationUrl = extractFirstUrl(inviteMailBody.Text);

    assert(
      urlStartsWithBase(invitationUrl, customerBase, "/invite/"),
      `Invitation URL was not rewritten through customer-web: ${invitationUrl}`,
    );

    console.log(`invitationUrl=${invitationUrl}`);

    await inviteePage.goto(normalizeLoopbackUrl(invitationUrl, customerBase), {
      waitUntil: "networkidle",
    });
    await fillInputByLabel(inviteePage, "Display name", "Invitee Example");
    await fillInputByLabel(inviteePage, "Email", inviteeEmail, 1);
    await fillInputByLabel(inviteePage, "Password", inviteePassword, 1);
    await inviteePage.getByRole("button", { name: "Create account" }).click();
    await waitForUrlMatch(inviteePage, /\/verification-pending/);
    await inviteePage.locator(`text=${inviteeEmail}`).first().waitFor();

    const inviteeVerificationMail = await waitForMessage({
      to: inviteeEmail,
      subject: "Verify your firapps email",
    });
    const inviteeVerificationBody = await getMessage(inviteeVerificationMail.ID);
    const inviteeVerificationUrl = extractFirstUrl(inviteeVerificationBody.Text);

    assert(
      urlStartsWithBase(inviteeVerificationUrl, customerBase, "/post-verify"),
      `Invitee verification URL was not rewritten through customer-web: ${inviteeVerificationUrl}`,
    );

    console.log(`inviteeVerificationUrl=${inviteeVerificationUrl}`);

    await inviteePage.goto(inviteeVerificationUrl, { waitUntil: "networkidle" });
    await waitForUrlMatch(inviteePage, /\/invite\//);
    await inviteePage.goto(normalizeLoopbackUrl(invitationUrl, customerBase), {
      waitUntil: "networkidle",
    });
    await inviteePage.getByText("Invitation state").waitFor({ timeout: 30_000 });
    await inviteePage.getByRole("button", { name: "Accept invitation" }).waitFor({
      timeout: 30_000,
    });
    await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
    await inviteePage
      .getByText("Invitation accepted. The organization is now active on your session.")
      .waitFor({ timeout: 30_000 });

    await ownerPage.goto(`${adminBase}/members`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Members" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.locator(`text=${inviteeEmail}`).first().waitFor({ timeout: 30_000 });

    await inviteePage.goto(`${customerBase}/forgot-password`, { waitUntil: "networkidle" });
    await fillInputByLabel(inviteePage, "Email", inviteeEmail);
    await inviteePage.getByRole("button", { name: "Send reset email" }).click();
    await inviteePage
      .getByText("Password reset email sent to Mailpit if the account exists.")
      .waitFor({ timeout: 30_000 });

    const resetMail = await waitForMessage({
      to: inviteeEmail,
      subject: "Reset your firapps password",
    });
    const resetMailBody = await getMessage(resetMail.ID);
    const resetUrl = extractFirstUrl(resetMailBody.Text);

    assert(
      urlStartsWithBase(resetUrl, customerBase, "/reset-password"),
      `Reset URL was not rewritten through customer-web: ${resetUrl}`,
    );

    console.log(`resetUrl=${resetUrl}`);

    await inviteePage.goto(normalizeLoopbackUrl(resetUrl, customerBase), {
      waitUntil: "networkidle",
    });
    await fillInputByLabel(inviteePage, "New password", inviteeResetPassword);
    await fillInputByLabel(inviteePage, "Confirm password", inviteeResetPassword);
    await inviteePage.getByRole("button", { name: "Reset password" }).click();
    await inviteePage.getByText("Password updated. Sign in with the new password.").waitFor({
      timeout: 30_000,
    });

    await freshSignInPage.goto(`${customerBase}/sign-in`, { waitUntil: "networkidle" });
    await fillInputByLabel(freshSignInPage, "Email", inviteeEmail);
    await fillInputByLabel(freshSignInPage, "Password", inviteeResetPassword);
    await freshSignInPage.getByRole("button", { name: "Sign in" }).click();
    await waitForUrlMatch(freshSignInPage, `${customerBase}/`);
    await freshSignInPage.getByText("My work hub").first().waitFor({ timeout: 30_000 });
    await freshSignInPage.getByText("Next best action").first().waitFor({
      timeout: 30_000,
    });

    await ownerPage.goto(`${adminBase}/projects`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Projects" }).waitFor({
      timeout: 30_000,
    });
    await fillInputByLabel(ownerPage, "Project name", projectName);
    await fillInputByLabel(ownerPage, "Project slug", projectSlug);
    await fillInputByLabel(ownerPage, "Project description", projectDescription);
    await expectInputValueByLabel(ownerPage, "Repository provider", projectRepoProvider);
    await fillInputByLabel(ownerPage, "Repository owner", projectRepoOwner);
    await fillInputByLabel(ownerPage, "Repository name", projectRepoName);
    await fillInputByLabel(ownerPage, "Default branch", projectDefaultBranch);
    await ownerPage.getByLabel("Workflow mode").selectOption("blueprint");
    await fillInputByLabel(ownerPage, "Billing contact email", ownerEmail);
    await fillInputByLabel(ownerPage, "Billing plan", "growth");
    await fillInputByLabel(ownerPage, "Billing reference", workspaceBillingReference);
    await ownerPage.getByRole("button", { name: "Create project" }).click();
    await ownerPage.getByText("Project created.").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(projectName).first().waitFor({ timeout: 30_000 });
    const createdProjectCard = ownerPage
      .locator("div.rounded-xl.border.p-4")
      .filter({ hasText: projectName })
      .first();
    await createdProjectCard.getByText("Dispatch readiness").waitFor({ timeout: 30_000 });
    await waitForAnyVisible([
      () => createdProjectCard.getByText("dispatch ready").first(),
      () => createdProjectCard.getByText("dispatch attention").first(),
      () => createdProjectCard.getByText("dispatch blocked").first(),
      () => createdProjectCard.getByText("dispatch pending").first(),
    ]);

    await ownerPage.goto(`${adminBase}/blueprints`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Blueprint selection and dispatch" }).waitFor({
      timeout: 30_000,
    });
    await fillInputByLabel(ownerPage, "Blueprint name", blueprintName);
    await fillInputByLabel(ownerPage, "Slug", blueprintSlug);
    await fillInputByLabel(ownerPage, "Description", blueprintDescription);
    await ownerPage.getByRole("button", { name: "Create blueprint" }).click();
    await ownerPage.getByText("Blueprint created.").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(blueprintName).first().waitFor({ timeout: 30_000 });

    await ownerPage.goto(`${adminBase}/projects`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Projects" }).waitFor({
      timeout: 30_000,
    });
    const projectInventoryCard = ownerPage
      .locator("div.rounded-xl.border.p-4")
      .filter({ hasText: projectName })
      .first();
    const defaultBlueprintSelect = projectInventoryCard.locator("select").first();
    const defaultBlueprintLabel = `${blueprintName} (organization)`;
    await defaultBlueprintSelect.selectOption({
      label: defaultBlueprintLabel,
    });
    await projectInventoryCard.getByRole("button", { name: "Save default" }).click();
    await ownerPage
      .getByText(`Default Blueprint saved for ${projectName}.`)
      .waitFor({ timeout: 30_000 });
    await ownerPage.reload({ waitUntil: "networkidle" });
    const refreshedProjectInventoryCard = ownerPage
      .locator("div.rounded-xl.border.p-4")
      .filter({ hasText: projectName })
      .first();
    await expectSelectedOptionLabel(
      refreshedProjectInventoryCard.locator("select").first(),
      defaultBlueprintLabel,
    );

    await ownerPage.goto(`${adminBase}/blueprints`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Blueprint selection and dispatch" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.locator("button").filter({ hasText: blueprintName }).first().click();
    await fillInputByLabel(ownerPage, "Blueprint name", updatedBlueprintName, 1);
    await fillInputByLabel(ownerPage, "Slug", updatedBlueprintSlug, 1);
    await fillInputByLabel(ownerPage, "Description", updatedBlueprintDescription, 1);
    await ownerPage.getByRole("button", { name: "Save changes" }).click();
    await ownerPage
      .getByText(`Blueprint ${updatedBlueprintName} updated.`)
      .first()
      .waitFor({ timeout: 30_000 });

    ownerPage.once("dialog", (dialog) => dialog.accept());
    await ownerPage.getByRole("button", { name: "Archive" }).click();
    await ownerPage
      .getByText(`Blueprint ${updatedBlueprintName} archived.`)
      .first()
      .waitFor({ timeout: 30_000 });
    const archivedBlueprintRow = ownerPage
      .locator("div.rounded-xl.border.p-3")
      .filter({ hasText: updatedBlueprintName })
      .first();
    await archivedBlueprintRow.waitFor({ timeout: 30_000 });
    await archivedBlueprintRow.getByRole("button", { name: "Reactivate" }).click();
    await ownerPage
      .getByText(`Blueprint ${updatedBlueprintName} reactivated.`)
      .first()
      .waitFor({ timeout: 30_000 });
    await ownerPage.getByLabel("Target project").selectOption({
      label: `${projectName} (${projectSlug})`,
    });
    await ownerPage.getByRole("link", { name: "Open run composer" }).click();
    await ownerPage.getByRole("heading", { name: "Runs and results" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage
      .getByText(`Blueprint handoff ready: ${projectName} + ${updatedBlueprintName}.`)
      .waitFor({ timeout: 30_000 });
    await expectSelectedOptionLabel(
      ownerPage.getByLabel("Project"),
      `${projectName} (${projectSlug})`,
    );
    await expectSelectedOptionLabel(
      ownerPage.getByLabel("Blueprint"),
      `${updatedBlueprintName} (organization)`,
    );
    await ownerPage.getByLabel("Project").selectOption({
      label: `${projectName} (${projectSlug})`,
    });
    await fillInputByLabel(ownerPage, "Run title", runTitle);
    await fillInputByLabel(ownerPage, "Objective", runObjective);
    await ownerPage.getByRole("button", { name: "Dispatch run" }).click();
    await ownerPage
      .getByText("Run dispatched into the isolated devbox pipeline.")
      .waitFor({ timeout: 30_000 });
    await ownerPage.getByText(runTitle).first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("Provision devbox").first().waitFor({ timeout: 30_000 });

    await fillInputByLabel(ownerPage, "Requester display name", "Owner Example");
    await fillInputByLabel(ownerPage, "Sidechannel channel", "launch-ops");
    await fillInputByLabel(ownerPage, "Dispatch secret", dispatchWebhookSecret);
    await fillInputByLabel(ownerPage, "Sidechannel title", slackRunTitle);
    await fillInputByLabel(ownerPage, "Sidechannel objective", slackRunObjective);
    await ownerPage.getByRole("button", { name: "Dispatch from sidechannel" }).click();
    await ownerPage
      .getByText("Slack-style sidechannel dispatch accepted.")
      .waitFor({ timeout: 30_000 });
    await ownerPage.getByText(slackRunTitle).first().waitFor({ timeout: 30_000 });

    const runWorkspaceSurface = await waitForRunWorkspaceSurface({
      page: ownerPage,
      runTitle,
    });
    const dispatchedRunId = await waitForRunIdByTitle({
      page: ownerPage,
      title: runTitle,
    });
    const runExecutionPatch = await waitForRunExecutionPatch({
      page: ownerPage,
      readmeMutationMarker,
      runId: dispatchedRunId,
    });
    assert(
      runExecutionPatch.pushStatus === "succeeded",
      `Run execution did not report a successful push. actual=${runExecutionPatch.pushStatus}`,
    );
    assert(
      runExecutionPatch.branchName,
      "Run execution artifacts did not expose the published workspace branch.",
    );
    assert(
      runExecutionPatch.patchValue.includes(`+${readmeMutationMarker}`),
      `Run execution patch did not include the README marker line. marker=${readmeMutationMarker}`,
    );
    console.log(`runExecutionBranch=${runExecutionPatch.branchName}`);

    if (runWorkspaceSurface.ready && runWorkspaceSurface.ideLink) {
      const ideHref = await runWorkspaceSurface.ideLink.getAttribute("href");

      assert(ideHref, "Run detail did not expose a devbox URL.");

      const [idePage] = await Promise.all([
        ownerPage.waitForEvent("popup"),
        runWorkspaceSurface.ideLink.click(),
      ]);

      await idePage.waitForLoadState("domcontentloaded", { timeout: 30_000 });
      assert(
        idePage.url().startsWith(ideHref),
        `Workspace IDE page did not open the expected access path. expected=${ideHref} actual=${idePage.url()}`,
      );
      await idePage.getByText("code-server").first().waitFor({ timeout: 30_000 });
      await idePage.close();
    } else {
      console.log("runWorkspacePending=true");
    }

    await ownerPage.goto(`${adminBase}/devboxes`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Devboxes" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByLabel("Project").selectOption({
      label: `${projectName} (${projectSlug})`,
    });
    await expectInputValueByLabel(ownerPage, "Repository owner", projectRepoOwner);
    await expectInputValueByLabel(ownerPage, "Repository name", projectRepoName);
    await fillInputByLabel(ownerPage, "Optional nix packages", manualDevboxPackagesInput);
    await ownerPage.getByRole("button", { name: "Create devbox" }).click();
    await ownerPage.getByText("Devbox created.").waitFor({ timeout: 30_000 });
    const manualDevboxRow = ownerPage
      .locator("div.rounded-xl.border.p-4")
      .filter({ hasText: projectName })
      .filter({ hasText: manualDevboxPackagesText })
      .first();
    await manualDevboxRow.waitFor({ timeout: 30_000 });
    await manualDevboxRow.getByRole("button", { name: "Delete devbox" }).click();
    await ownerPage
      .getByText("Devbox deleted.")
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await manualDevboxRow.waitFor({ state: "detached", timeout: 60_000 });

    await ownerPage.goto(`${adminBase}/members`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Members" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.locator(`text=${ownerEmail}`).first().waitFor({ timeout: 30_000 });
    await ownerPage.locator(`text=${inviteeEmail}`).first().waitFor({ timeout: 30_000 });
    await fillInputByLabel(ownerPage, "Invitee email", pendingInviteEmail);
    await ownerPage.getByRole("button", { name: "Send invitation" }).click();
    await ownerPage.getByText("Invitation created.").waitFor({ timeout: 30_000 });
    const pendingInvitationRow = ownerPage
      .locator("div.rounded-xl.border.p-3")
      .filter({ hasText: pendingInviteEmail })
      .first();
    await pendingInvitationRow.waitFor({ timeout: 30_000 });
    const invitationMessageCount = await countMessages({
      subject: invitationSubject,
      to: pendingInviteEmail,
    });
    await pendingInvitationRow.getByRole("button", { name: "Resend" }).click();
    await ownerPage.getByText("Invitation resent.").waitFor({ timeout: 30_000 });
    await waitForMessageCount({
      minCount: invitationMessageCount + 1,
      subject: invitationSubject,
      to: pendingInviteEmail,
    });
    await pendingInvitationRow.getByRole("button", { name: "Cancel" }).click();
    await ownerPage.getByText("Invitation cancelled.").waitFor({ timeout: 30_000 });
    await waitForAnyVisible([
      () => pendingInvitationRow.getByText("cancelled").first(),
      () => pendingInvitationRow.getByText("canceled").first(),
    ]);

    await ownerPage.goto(`${adminBase}/operators`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Operator view" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText(organizationName).first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(runTitle).first().waitFor({ timeout: 30_000 });

    await inviteePage.goto(adminBase, { waitUntil: "networkidle" });
    await ensureAdminOwnerSession({
      organizationName,
      ownerEmail: inviteeEmail,
      ownerPassword: inviteeResetPassword,
      page: inviteePage,
    });
    await inviteePage.goto(`${adminBase}/operators`, { waitUntil: "networkidle" });
    await inviteePage.getByRole("heading", { name: "Operator view" }).waitFor({
      timeout: 30_000,
    });
    await inviteePage.getByText("Operator data unavailable").waitFor({ timeout: 30_000 });
    await inviteePage
      .getByText("Internal API denied access for the current session.")
      .waitFor({ timeout: 30_000 });

    await inviteePage.goto(`${adminBase}/runs`, { waitUntil: "networkidle" });
    await inviteePage.getByRole("heading", { name: "Runs and results" }).waitFor({
      timeout: 30_000,
    });
    await inviteePage.getByText(runTitle).first().waitFor({ timeout: 30_000 });

    await inviteePage.goto(`${adminBase}/pull-requests`, { waitUntil: "networkidle" });
    await inviteePage.getByRole("heading", { name: "Pull request visibility" }).waitFor({
      timeout: 30_000,
    });
    await inviteePage.getByText(projectName).first().waitFor({ timeout: 30_000 });
    await waitForAnyVisible([
      () => inviteePage.getByRole("link", { name: "Open PR" }).first(),
      () =>
        inviteePage
          .getByText("No pull requests are visible for the active organization yet.")
          .first(),
    ]);

    await ownerPage.goto(`${adminBase}/control-plane`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Project control plane" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText(projectName).first().waitFor({ timeout: 30_000 });

    await ownerPage.goto(`${adminBase}/queue`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Run queue" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText("Capacity snapshot").first().waitFor({ timeout: 30_000 });
    await waitForAnyVisible([
      () => ownerPage.getByText(runTitle).first(),
      () => ownerPage.getByText(slackRunTitle).first(),
      () =>
        ownerPage
          .getByText("No blocked, quiet, or failure-signaling runs are visible right now.")
          .first(),
    ]);

    await ownerPage.goto(`${adminBase}/pull-requests`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Pull request visibility" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText("Review attention").first().waitFor({ timeout: 30_000 });
    const openPrLink = await waitForPullRequestSurface({
      page: ownerPage,
      projectName,
    });
    await openPrLink.waitFor({ timeout: 30_000 });

    await ownerPage.goto(`${adminBase}/runs/${dispatchedRunId}`, { waitUntil: "networkidle" });
    await ownerPage.getByText(runTitle).first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("Outcome and next action").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("Workspace and devbox").first().waitFor({ timeout: 30_000 });
    await waitForAnyVisible([
      () => ownerPage.getByRole("link", { name: "Open pull request" }).first(),
      () => ownerPage.getByText("Workspace ID:").first(),
      () => ownerPage.getByText("No workspace is attached to this run yet.").first(),
    ]);

    await ownerPage.goto(`${adminBase}/billing`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Billing inventory" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText(projectName).first().waitFor({ timeout: 30_000 });
    await expectInputValueByLabel(ownerPage, "Billing reference", workspaceBillingReference);
    await fillInputByLabel(ownerPage, "Billing status", "watch");
    await ownerPage.getByRole("button", { name: "Save billing" }).click();
    await ownerPage
      .getByText(`Billing placeholders saved for ${projectName}.`)
      .waitFor({ timeout: 30_000 });
    await expectInputValueByLabel(ownerPage, "Billing status", "watch");

    await ownerPage.goto(`${adminBase}/activity`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "Activity" }).waitFor({
      timeout: 30_000,
    });
    await waitForAnyVisible([
      () => ownerPage.getByText(runTitle).first(),
      () => ownerPage.getByText(projectName).first(),
      () =>
        ownerPage
          .getByText(
            "No recent project, run, or workspace events are visible for the active organization.",
          )
          .first(),
    ]);

    await ownerPage.goto(`${customerBase}/runs`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { name: "My runs" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText("Next action").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("requestedBy=self").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(runTitle).first().waitFor({ timeout: 30_000 });

    await ownerPage.goto(`${customerBase}/runs/${dispatchedRunId}`, { waitUntil: "networkidle" });
    await ownerPage.getByText(runTitle).first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("Outcome and next action").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("requestedBy=self").first().waitFor({ timeout: 30_000 });
    await waitForAnyVisible([
      () => ownerPage.getByRole("link", { name: "Open pull request" }).first(),
      () => ownerPage.getByText("Workspace ID:").first(),
      () => ownerPage.getByText("No workspace is attached to this run yet.").first(),
    ]);

    await ownerPage.goto(`${customerBase}/pull-requests`, { waitUntil: "networkidle" });
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

    await ownerPage.goto(`${customerBase}/organization`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { exact: true, name: "Organization" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText(organizationName).first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(projectName).first().waitFor({ timeout: 30_000 });

    await inviteePage.goto(`${customerBase}/invitations`, { waitUntil: "networkidle" });
    await inviteePage.getByRole("heading", { name: "Invitations" }).waitFor({
      timeout: 30_000,
    });
    await waitForAnyVisible([
      () => inviteePage.getByText(organizationName).first(),
      () =>
        inviteePage
          .getByText("No invitation records are visible for this account right now.")
          .first(),
    ]);

    await ownerPage.goto(`${customerBase}/account`, { waitUntil: "networkidle" });
    await ownerPage.getByRole("heading", { exact: true, name: "Account" }).waitFor({
      timeout: 30_000,
    });
    await ownerPage.getByText(ownerEmail).first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(organizationName).first().waitFor({ timeout: 30_000 });

    await inviteePage.goto(`${customerBase}/runs`, { waitUntil: "networkidle" });
    await inviteePage.getByRole("heading", { name: "My runs" }).waitFor({
      timeout: 30_000,
    });
    await inviteePage.getByText("requestedBy=self").first().waitFor({ timeout: 30_000 });
    await inviteePage
      .getByText("No member-scoped runs are visible for the active organization yet.")
      .waitFor({ timeout: 30_000 });
    assert(
      (await inviteePage.getByRole("link", { name: "Open detail page" }).count()) === 0,
      "Invitee unexpectedly received run detail links for another member's work.",
    );

    await inviteePage.goto(`${customerBase}/pull-requests`, { waitUntil: "networkidle" });
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

    await ownerPage.goto(`${customerBase}/`, { waitUntil: "networkidle" });
    await clickButtonByExactName(ownerPage, "Refresh customer workspace");
    await ownerPage.getByText("My work hub").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText("Next best action").first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(projectName).first().waitFor({ timeout: 30_000 });
    await ownerPage.getByText(runTitle).first().waitFor({ timeout: 30_000 });
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

    console.log("PLAYWRIGHT_BETTER_AUTH_E2E_OK");
  } finally {
    await freshSignInContext.close();
    await inviteeContext.close();
    await ownerContext.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
