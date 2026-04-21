import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MailCheck, RotateCcw } from "lucide-react";

import { AppPage, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import { buildCustomerPath, buildCustomerUrl, toErrorMessage } from "../lib/customer-auth";

export const Route = createFileRoute("/verification-pending")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : "",
    next: typeof search.next === "string" ? search.next : "/",
  }),
  component: VerificationPendingPage,
});

function VerificationPendingPage() {
  const search = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);

  async function resendVerificationEmail() {
    setBusy(true);
    setNotice(null);

    try {
      const result = await authClient.sendVerificationEmail({
        callbackURL: buildCustomerUrl(search.next, "/"),
        email: search.email,
      });

      if (result.error) {
        throw result.error;
      }

      setNotice({
        message: "Verification email re-sent to Mailpit.",
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to resend the verification email."),
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Check Mailpit and verify the account"
      description="The account exists, but Better Auth will not create a session until the verification link is completed."
    >
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailCheck className="size-5" />
              Verification pending
            </CardTitle>
            <CardDescription>
              Open Mailpit, click the verification link, and customer-web will continue to{" "}
              {buildCustomerPath(search.next, "/")}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground">Pending email</p>
              <p className="mt-2 break-all text-sm text-muted-foreground">
                {search.email || "No email address was provided."}
              </p>
            </div>

            {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}

            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy || !search.email}
                onClick={() => void resendVerificationEmail()}
                type="button"
              >
                <RotateCcw className="size-4" />
                {busy ? "Resending..." : "Resend verification email"}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link
                  search={{
                    email: search.email,
                    redirect: search.next,
                  }}
                  to="/sign-in"
                >
                  Go to sign in
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}

function InlineNotice({ message, tone }: { message: string; tone: "danger" | "success" }) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";

  return <div className={`rounded-xl border px-3 py-2 text-sm ${toneClass}`}>{message}</div>;
}
