import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

function resolveAuthBaseUrl() {
  const origin =
    typeof window === "undefined"
      ? (process.env.CUSTOMER_WEB_URL ?? "http://127.0.0.1:3000")
      : window.location.origin;

  return new URL("/api/auth", origin).toString();
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseUrl(),
  fetchOptions: {
    credentials: "include",
  },
  plugins: [organizationClient()],
});
