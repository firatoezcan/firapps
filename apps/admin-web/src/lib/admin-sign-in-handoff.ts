const defaultCustomerWebUrl = "http://127.0.0.1:3000";
const defaultAdminWebUrl = "http://127.0.0.1:3001";

function resolveCustomerOrigin() {
  const configuredCustomerOrigin = process.env.CUSTOMER_WEB_URL;

  if (typeof configuredCustomerOrigin === "string" && configuredCustomerOrigin.length > 0) {
    return configuredCustomerOrigin;
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  return defaultCustomerWebUrl;
}

function resolveAdminOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return process.env.ADMIN_WEB_URL ?? defaultAdminWebUrl;
}

function normalizeAdminPath(pathOrUrl: string | undefined, fallbackPath: string) {
  const adminOrigin = new URL(resolveAdminOrigin());

  try {
    const target = new URL(pathOrUrl || fallbackPath, adminOrigin);

    if (target.origin !== adminOrigin.origin) {
      return fallbackPath;
    }

    return `${target.pathname}${target.search}${target.hash}` || fallbackPath;
  } catch {
    return fallbackPath;
  }
}

export function getCurrentAdminPath(fallbackPath: string) {
  if (typeof window === "undefined") {
    return fallbackPath;
  }

  return normalizeAdminPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    fallbackPath,
  );
}

export function buildCustomerSignInHref(returnPath: string, fallbackPath: string) {
  const safeReturnPath = normalizeAdminPath(returnPath, fallbackPath);
  const customerOrigin = new URL(resolveCustomerOrigin());
  const postSignInUrl = new URL("/", customerOrigin);

  postSignInUrl.searchParams.set("adminReturn", safeReturnPath);

  const signInUrl = new URL("/sign-in", customerOrigin);

  signInUrl.searchParams.set(
    "redirect",
    `${postSignInUrl.pathname}${postSignInUrl.search}${postSignInUrl.hash}`,
  );

  return {
    href: signInUrl.toString(),
    returnPath: safeReturnPath,
  };
}
