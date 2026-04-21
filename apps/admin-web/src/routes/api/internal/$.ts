import { createFileRoute } from "@tanstack/react-router";

import { proxyRequestToTarget, readProxyTarget } from "../../../lib/server-proxy";

const internalApiProxyTarget = readProxyTarget(
  "VITE_INTERNAL_API_URL",
  "http://127.0.0.1:4001/api/internal",
);

async function forwardRequest(request: Request) {
  return proxyRequestToTarget(request, "/api/internal", internalApiProxyTarget);
}

export const Route = createFileRoute("/api/internal/$")({
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
