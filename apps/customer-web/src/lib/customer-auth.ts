type OrgBootstrapDraft = {
  name: string;
  slug: string;
};

const orgBootstrapDraftStorageKey = "firapps.customer.pending-org-bootstrap";

function resolveCustomerOrigin() {
  return typeof window === "undefined"
    ? (process.env.CUSTOMER_WEB_URL ?? "http://127.0.0.1:3000")
    : window.location.origin;
}

function resolveCustomerUrl(pathOrUrl?: string, fallback = "/") {
  const base = new URL(resolveCustomerOrigin());

  try {
    const target = new URL(pathOrUrl || fallback, base);
    return target.origin === base.origin ? target : new URL(fallback, base);
  } catch {
    return new URL(fallback, base);
  }
}

export function buildCustomerUrl(pathOrUrl?: string, fallback = "/") {
  return resolveCustomerUrl(pathOrUrl, fallback).toString();
}

export function buildCustomerPath(pathOrUrl?: string, fallback = "/") {
  const target = resolveCustomerUrl(pathOrUrl, fallback);
  return `${target.pathname}${target.search}${target.hash}` || fallback;
}

export function storeOrgBootstrapDraft(draft: OrgBootstrapDraft) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(orgBootstrapDraftStorageKey, JSON.stringify(draft));
}

export function readOrgBootstrapDraft() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(orgBootstrapDraftStorageKey);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OrgBootstrapDraft>;

    if (
      typeof parsed.name === "string" &&
      parsed.name.length > 0 &&
      typeof parsed.slug === "string" &&
      parsed.slug.length > 0
    ) {
      return {
        name: parsed.name,
        slug: parsed.slug,
      } satisfies OrgBootstrapDraft;
    }
  } catch {
    return null;
  }

  return null;
}

export function clearOrgBootstrapDraft() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(orgBootstrapDraftStorageKey);
}

export function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return fallback;
}

export function isEmailNotVerifiedError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EMAIL_NOT_VERIFIED"
  ) {
    return true;
  }

  return toErrorMessage(error, "").toLowerCase().includes("email not verified");
}

export function toRoleLabel(role: string) {
  if (role === "owner") {
    return "Owner";
  }

  if (role === "admin") {
    return "Admin";
  }

  return "Member";
}
