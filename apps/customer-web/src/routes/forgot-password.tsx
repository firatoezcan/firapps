import { Link, createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";

import { AppPage, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import { buildCustomerUrl, toErrorMessage } from "../lib/customer-auth";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setNotice(null);

    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: buildCustomerUrl("/reset-password"),
      });

      if (result.error) {
        throw result.error;
      }

      setNotice({
        message: "Password reset email sent to Mailpit if the account exists.",
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to request a password reset."),
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Request a password reset"
      description="Better Auth sends the reset link to Mailpit, then customer-web finishes the password reset against the same auth server."
    >
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5" />
              Password reset
            </CardTitle>
            <CardDescription>
              Enter the verified email address used for the customer account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">Email</span>
                <input
                  autoComplete="email"
                  className="h-11 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-primary/15"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>

              {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}

              <div className="flex flex-wrap gap-3">
                <Button disabled={busy} type="submit">
                  {busy ? "Requesting..." : "Send reset email"}
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link
                    search={{
                      email: "",
                      redirect: "/",
                    }}
                    to="/sign-in"
                  >
                    Back to sign in
                  </Link>
                </Button>
              </div>
            </form>
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
