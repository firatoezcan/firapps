import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { LoaderCircle } from "lucide-react";

import { AppPage, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@firapps/ui";

import { buildCustomerUrl } from "../lib/customer-auth";

export const Route = createFileRoute("/post-verify")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : "/",
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: PostVerifyPage,
});

function PostVerifyPage() {
  const search = Route.useSearch();
  const nextUrl = useMemo(() => buildCustomerUrl(search.next, "/"), [search.next]);

  useEffect(() => {
    if (typeof window === "undefined" || !search.token) {
      return;
    }

    const verifyUrl = new URL("/api/auth/verify-email", window.location.origin);
    verifyUrl.searchParams.set("token", search.token);
    verifyUrl.searchParams.set("callbackURL", nextUrl);
    window.location.replace(verifyUrl.toString());
  }, [nextUrl, search.token]);

  return (
    <AppPage
      eyebrow="Customer web"
      title="Finalizing verification"
      description="Customer-web is forwarding the Better Auth verification token through the local proxy so the session cookie is written on the frontend host."
    >
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LoaderCircle className="size-5 animate-spin" />
              Verifying email
            </CardTitle>
            <CardDescription>
              If nothing happens, reload this page from the same browser session you used to open
              Mailpit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Verification target: {nextUrl}</p>
            {!search.token ? (
              <p className="text-destructive">
                No token was provided. Open the verification link directly from Mailpit.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}
