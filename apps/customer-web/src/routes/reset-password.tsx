import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";

import { AppPage, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import { toErrorMessage } from "../lib/customer-auth";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : "",
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(
    search.error
      ? {
          message: `The password reset link is invalid: ${search.error}`,
          tone: "danger",
        }
      : null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!search.token) {
      setNotice({
        message: "No reset token was provided.",
        tone: "danger",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setNotice({
        message: "The password confirmation does not match.",
        tone: "danger",
      });
      return;
    }

    setBusy(true);
    setNotice(null);

    try {
      const result = await authClient.resetPassword({
        newPassword,
        token: search.token,
      });

      if (result.error) {
        throw result.error;
      }

      setNotice({
        message: "Password updated. Sign in with the new password.",
        tone: "success",
      });
      setNewPassword("");
      setConfirmPassword("");
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to reset the password."),
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Choose a new password"
      description="This route receives the token from the Mailpit reset email and completes the Better Auth password change through the local proxy."
    >
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKeyhole className="size-5" />
              Reset password
            </CardTitle>
            <CardDescription>
              Use the link from Mailpit. The token is carried on the current route.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {search.token ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Field
                  autoComplete="new-password"
                  label="New password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
                <Field
                  autoComplete="new-password"
                  label="Confirm password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />

                {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}

                <div className="flex flex-wrap gap-3">
                  <Button disabled={busy} type="submit">
                    {busy ? "Updating..." : "Reset password"}
                  </Button>
                  <Button
                    onClick={() =>
                      void navigate({
                        search: {
                          email: "",
                          redirect: "/",
                        },
                        to: "/sign-in",
                      })
                    }
                    type="button"
                    variant="outline"
                  >
                    Back to sign in
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}
                <p className="text-sm text-muted-foreground">
                  Open the reset link directly from Mailpit to populate the token on this route.
                </p>
                <Button asChild variant="outline">
                  <Link to="/forgot-password">Request another reset email</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}

function Field({
  label,
  ...props
}: { label: string } & Omit<React.ComponentProps<"input">, "className">) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        className="h-11 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-primary/15"
        {...props}
      />
    </label>
  );
}

function InlineNotice({ message, tone }: { message: string; tone: "danger" | "success" }) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";

  return <div className={`rounded-xl border px-3 py-2 text-sm ${toneClass}`}>{message}</div>;
}
