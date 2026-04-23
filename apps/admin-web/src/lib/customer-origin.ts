const defaultCustomerWebUrl = "http://127.0.0.1:3000";

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

function deriveCustomerOriginFromWindow() {
  const current = new URL(window.location.origin);

  if (/^(admin|customer)\./.test(current.hostname)) {
    current.hostname = current.hostname.replace(/^(admin|customer)\./, "customer.");
    return current.origin;
  }

  if (isLoopbackHostname(current.hostname) && current.port) {
    const currentPort = Number(current.port);

    if (Number.isInteger(currentPort) && currentPort > 0 && currentPort % 100 === 1) {
      current.port = String(currentPort - 1);
      return current.origin;
    }
  }

  return null;
}

export function resolveCustomerOrigin() {
  const configuredCustomerOrigin = normalizeOriginCandidate(process.env.CUSTOMER_WEB_URL);

  if (configuredCustomerOrigin) {
    return configuredCustomerOrigin;
  }

  if (typeof window !== "undefined") {
    return deriveCustomerOriginFromWindow() ?? defaultCustomerWebUrl;
  }

  return defaultCustomerWebUrl;
}
