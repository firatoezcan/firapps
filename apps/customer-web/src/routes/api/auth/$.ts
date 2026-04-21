import { createFileRoute } from "@tanstack/react-router";

import { proxyRequestToTarget, readProxyTarget } from "../../../lib/server-proxy";

const authProxyTarget = readProxyTarget("AUTH_PROXY_TARGET", "http://127.0.0.1:4001/api/auth");

async function forwardRequest(request: Request) {
  return proxyRequestToTarget(request, "/api/auth", authProxyTarget);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => forwardRequest(request),
      POST: ({ request }) => forwardRequest(request),
      PUT: ({ request }) => forwardRequest(request),
      PATCH: ({ request }) => forwardRequest(request),
      DELETE: ({ request }) => forwardRequest(request),
      OPTIONS: ({ request }) => forwardRequest(request),
    },
  },
});
