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

function buildForwardHeaders(request: Request) {
  const requestUrl = new URL(request.url);
  const headers = new Headers(request.headers);

  for (const headerName of hopByHopHeaders) {
    headers.delete(headerName);
  }

  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));

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
