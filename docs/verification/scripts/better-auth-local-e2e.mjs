#!/usr/bin/env node

import { chromium } from "@playwright/test";

const customerBase = process.env.CUSTOMER_WEB_URL ?? "http://localhost:3000";
const adminBase = process.env.ADMIN_WEB_URL ?? "http://localhost:3001";
const mailpitBase = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025/api/v1";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function getMessage(messageId) {
  return fetchJson(`${mailpitBase}/message/${messageId}`);
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/\S+/);
  assert(match, "No URL found in Mailpit message body");
  return match[0];
}

async function fillInputByLabel(page, label, value, nth = 0) {
  await page.getByLabel(label).nth(nth).fill(value);
}

async function main() {
  const runId = Date.now();
  const ownerEmail = `owner.${runId}@example.com`;
  const inviteeEmail = `invitee.${runId}@example.com`;
  const ownerPassword = `OwnerPass!${runId}`;
  const inviteePassword = `InviteePass!${runId}`;
  const inviteeResetPassword = `InviteeReset!${runId}`;
  const organizationName = `Run ${runId} Org`;
  const organizationSlug = `run-${runId}-org`;

  console.log(`ownerEmail=${ownerEmail}`);
  console.log(`inviteeEmail=${inviteeEmail}`);

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
    await ownerPage.waitForURL(/\/verification-pending/);
    await ownerPage.locator(`text=${ownerEmail}`).first().waitFor();

    const ownerVerificationMail = await waitForMessage({
      to: ownerEmail,
      subject: "Verify your firapps email",
    });
    const ownerVerificationBody = await getMessage(ownerVerificationMail.ID);
    const ownerVerificationUrl = extractFirstUrl(ownerVerificationBody.Text);

    assert(
      ownerVerificationUrl.startsWith(`${customerBase}/post-verify`),
      `Owner verification URL was not rewritten through customer-web: ${ownerVerificationUrl}`,
    );

    console.log(`ownerVerificationUrl=${ownerVerificationUrl}`);

    await ownerPage.goto(ownerVerificationUrl, { waitUntil: "networkidle" });
    await ownerPage.waitForURL(/\/sign-up-complete/);
    await ownerPage
      .getByText("Organization bootstrap complete. Continue into the customer workspace.")
      .waitFor({ timeout: 30_000 });
    await ownerPage.getByRole("button", { name: "Continue to customer home" }).click();
    await ownerPage.waitForURL(`${customerBase}/`);
    await ownerPage.getByText(`Signed in as ${ownerEmail}.`).waitFor({ timeout: 30_000 });
    await ownerPage.locator(`text=${organizationName}`).first().waitFor({ timeout: 30_000 });

    await ownerPage.goto(adminBase, { waitUntil: "networkidle" });
    await ownerPage.getByText(`Signed in as ${ownerEmail}.`).waitFor({ timeout: 30_000 });
    await ownerPage
      .getByText(`Active organization: ${organizationName}`)
      .waitFor({ timeout: 30_000 });
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
      invitationUrl.startsWith(`${customerBase}/invite/`),
      `Invitation URL was not rewritten through customer-web: ${invitationUrl}`,
    );

    console.log(`invitationUrl=${invitationUrl}`);

    await inviteePage.goto(invitationUrl, { waitUntil: "networkidle" });
    await fillInputByLabel(inviteePage, "Display name", "Invitee Example");
    await fillInputByLabel(inviteePage, "Email", inviteeEmail, 1);
    await fillInputByLabel(inviteePage, "Password", inviteePassword, 1);
    await inviteePage.getByRole("button", { name: "Create account" }).click();
    await inviteePage.waitForURL(/\/verification-pending/);
    await inviteePage.locator(`text=${inviteeEmail}`).first().waitFor();

    const inviteeVerificationMail = await waitForMessage({
      to: inviteeEmail,
      subject: "Verify your firapps email",
    });
    const inviteeVerificationBody = await getMessage(inviteeVerificationMail.ID);
    const inviteeVerificationUrl = extractFirstUrl(inviteeVerificationBody.Text);

    assert(
      inviteeVerificationUrl.startsWith(`${customerBase}/post-verify`),
      `Invitee verification URL was not rewritten through customer-web: ${inviteeVerificationUrl}`,
    );

    console.log(`inviteeVerificationUrl=${inviteeVerificationUrl}`);

    await inviteePage.goto(inviteeVerificationUrl, { waitUntil: "networkidle" });
    await inviteePage.waitForURL(/\/invite\//);
    await inviteePage.goto(invitationUrl, { waitUntil: "networkidle" });
    await inviteePage.getByText("Invitation state").waitFor({ timeout: 30_000 });
    await inviteePage.getByRole("button", { name: "Accept invitation" }).waitFor({
      timeout: 30_000,
    });
    await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
    await inviteePage
      .getByText("Invitation accepted. The organization is now active on your session.")
      .waitFor({ timeout: 30_000 });

    await ownerPage.getByRole("button", { name: "Refresh" }).click();
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
      resetUrl.startsWith(`${customerBase}/reset-password?token=`),
      `Reset URL was not rewritten through customer-web: ${resetUrl}`,
    );

    console.log(`resetUrl=${resetUrl}`);

    await inviteePage.goto(resetUrl, { waitUntil: "networkidle" });
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
    await freshSignInPage.waitForURL(`${customerBase}/`);
    await freshSignInPage.getByText(`Signed in as ${inviteeEmail}.`).waitFor({
      timeout: 30_000,
    });

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
