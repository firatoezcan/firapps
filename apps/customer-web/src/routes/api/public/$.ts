import { createFileRoute } from "@tanstack/react-router";

import { proxyRequestToTarget, readProxyTarget } from "../../../lib/server-proxy";

const publicApiProxyTarget = readProxyTarget(
  "VITE_PUBLIC_API_URL",
  "http://127.0.0.1:4000/api/public",
);

async function forwardRequest(request: Request) {
  return proxyRequestToTarget(request, "/api/public", publicApiProxyTarget);
}

export const Route = createFileRoute("/api/public/$")({
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
