const defaultAdminWebUrl = "http://127.0.0.1:3001";

function normalizeOriginCandidate(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function deriveAdminOriginFromWindow() {
  const current = new URL(window.location.origin);

  if (/^(admin|customer)\./.test(current.hostname)) {
    current.hostname = current.hostname.replace(/^(admin|customer)\./, "admin.");
    return current.origin;
  }

  if (isLoopbackHostname(current.hostname) && current.port) {
    const currentPort = Number(current.port);

    if (Number.isInteger(currentPort) && currentPort > 0 && currentPort % 100 === 0) {
      current.port = String(currentPort + 1);
      return current.origin;
    }
  }

  return null;
}

export function resolveAdminOrigin() {
  const configuredAdminOrigin = normalizeOriginCandidate(process.env.ADMIN_WEB_URL);

  if (configuredAdminOrigin) {
    return configuredAdminOrigin;
  }

  if (typeof window !== "undefined") {
    return deriveAdminOriginFromWindow() ?? defaultAdminWebUrl;
  }

  return defaultAdminWebUrl;
}

export function buildAdminRouteHref(path: string) {
  return new URL(path, resolveAdminOrigin()).toString();
}
