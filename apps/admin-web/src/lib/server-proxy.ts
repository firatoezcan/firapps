const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function normalizeTargetBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveForwardedAuthOrigin(request: Request) {
  const configuredOrigin = process.env.ADMIN_AUTH_FORWARD_ORIGIN?.replace(/\/+$/, "");
  const requestUrl = new URL(request.url);
  const forwardedOrigin = configuredOrigin ?? request.headers.get("origin") ?? requestUrl.origin;

  try {
    return new URL(forwardedOrigin).origin;
  } catch {
    return requestUrl.origin;
  }
}

function buildForwardHeaders(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedAuthOrigin = resolveForwardedAuthOrigin(request);
  const headers = new Headers(request.headers);

  for (const headerName of hopByHopHeaders) {
    headers.delete(headerName);
  }

  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  headers.set("origin", forwardedAuthOrigin);
  headers.set("referer", `${forwardedAuthOrigin}/`);
  headers.delete("sec-fetch-dest");
  headers.delete("sec-fetch-mode");
  headers.delete("sec-fetch-site");

  return headers;
}

function buildTargetUrl(request: Request, routePrefix: string, targetBaseUrl: string) {
  const requestUrl = new URL(request.url);
  const normalizedPrefix = routePrefix.endsWith("/") ? routePrefix : `${routePrefix}/`;
  const pathname = requestUrl.pathname.startsWith(normalizedPrefix)
    ? requestUrl.pathname.slice(normalizedPrefix.length)
    : requestUrl.pathname.replace(/^\/+/, "");
  const targetUrl = new URL(pathname, normalizeTargetBaseUrl(targetBaseUrl));

  targetUrl.search = requestUrl.search;

  return targetUrl;
}

function requestCanHaveBody(method: string) {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

export async function proxyRequestToTarget(
  request: Request,
  routePrefix: string,
  targetBaseUrl: string,
) {
  const upstreamUrl = buildTargetUrl(request, routePrefix, targetBaseUrl);
  const init: RequestInit = {
    method: request.method,
    headers: buildForwardHeaders(request),
    redirect: "manual",
  };

  if (requestCanHaveBody(request.method)) {
    init.body = await request.arrayBuffer();
  }

  return fetch(upstreamUrl, init);
}

export function readProxyTarget(envName: string, fallbackUrl: string) {
  return process.env[envName] ?? fallbackUrl;
}

export function readInternalApiProxyTarget(envName: string, fallbackUrl: string) {
  const explicitTarget = process.env[envName];

  if (explicitTarget) {
    return explicitTarget;
  }

  const authProxyTarget = process.env.AUTH_PROXY_TARGET;

  if (!authProxyTarget) {
    return fallbackUrl;
  }

  try {
    const derivedTarget = new URL(authProxyTarget);

    derivedTarget.pathname = derivedTarget.pathname.replace(/\/api\/auth\/?$/, "/api/internal");

    if (derivedTarget.pathname.includes("/api/internal")) {
      return derivedTarget.toString();
    }
  } catch {
    return fallbackUrl;
  }

  return fallbackUrl;
}
