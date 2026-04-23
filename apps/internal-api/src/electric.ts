import type { Context } from "hono";

import { internalApiEnv } from "./config.js";

const forwardedQueryParams = new Set(["cursor", "handle", "live", "live_sse", "offset"]);
const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type ElectricShapeDefinition = {
  columns?: string[];
  params?: Record<string, string>;
  replica?: "default" | "full";
  table: string;
  where?: string;
};

export function electricSyncConfigured() {
  return Boolean(internalApiEnv.ELECTRIC_URL);
}

export async function proxyElectricShape(c: Context, definition: ElectricShapeDefinition) {
  if (!internalApiEnv.ELECTRIC_URL) {
    return c.json(
      {
        error: "electric_not_configured",
        message: "Electric queue sync is not configured for internal-api.",
      },
      503,
    );
  }

  const upstreamUrl = new URL("/v1/shape", normalizeElectricBaseUrl(internalApiEnv.ELECTRIC_URL));
  const requestUrl = new URL(c.req.url);

  for (const [key, value] of requestUrl.searchParams.entries()) {
    if (forwardedQueryParams.has(key)) {
      upstreamUrl.searchParams.set(key, value);
    }
  }

  if (!upstreamUrl.searchParams.has("offset")) {
    upstreamUrl.searchParams.set("offset", "-1");
  }

  upstreamUrl.searchParams.set("table", definition.table);
  if (definition.where) {
    upstreamUrl.searchParams.set("where", definition.where);
  }
  if (definition.columns && definition.columns.length > 0) {
    upstreamUrl.searchParams.set("columns", definition.columns.join(","));
  }
  if (definition.replica) {
    upstreamUrl.searchParams.set("replica", definition.replica);
  }
  if (internalApiEnv.ELECTRIC_SECRET) {
    upstreamUrl.searchParams.set("secret", internalApiEnv.ELECTRIC_SECRET);
  }

  for (const [index, value] of Object.entries(definition.params ?? {})) {
    upstreamUrl.searchParams.set(`params[${index}]`, value);
  }

  const headers = new Headers();
  const accept = c.req.header("accept");

  if (accept) {
    headers.set("accept", accept);
  }

  const upstream = await fetch(upstreamUrl, {
    headers,
    method: "GET",
  });

  return new Response(upstream.body, {
    headers: filterResponseHeaders(upstream.headers),
    status: upstream.status,
    statusText: upstream.statusText,
  });
}

function filterResponseHeaders(headers: Headers) {
  const filtered = new Headers();

  for (const [name, value] of headers.entries()) {
    if (hopByHopHeaders.has(name.toLowerCase())) {
      continue;
    }

    filtered.set(name, value);
  }

  return filtered;
}

function normalizeElectricBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
