import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ArrowRight, LogIn } from "lucide-react";

import { AppPage, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import { buildCustomerPath, isEmailNotVerifiedError, toErrorMessage } from "../lib/customer-auth";

type SignInSearch = {
  email?: string;
  redirect?: string;
};

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    const nextSearch: SignInSearch = {};

    if (typeof search.email === "string" && search.email.length > 0) {
      nextSearch.email = search.email;
    }

    if (typeof search.redirect === "string" && search.redirect.length > 0) {
      nextSearch.redirect = search.redirect;
    }

    return nextSearch;
  },
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const sessionQuery = authClient.useSession();
  const redirectPath = buildCustomerPath(search.redirect, "/");

  const [email, setEmail] = useState(search.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const result = await authClient.signIn.email({
        email: normalizedEmail,
        password,
      });

      if (result.error) {
        if (isEmailNotVerifiedError(result.error)) {
          await navigate({
            to: "/verification-pending",
            search: {
              email: normalizedEmail,
              next: redirectPath,
            },
          });
          return;
        }

        throw result.error;
      }

      await sessionQuery.refetch();
      await navigate({
        to: redirectPath,
      });
    } catch (caughtError) {
      setError(toErrorMessage(caughtError, "Unable to sign in."));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Sign in with Better Auth"
      description="Resume your customer session, switch into an invited organization, or continue after password reset."
    >
      <div className="mx-auto grid max-w-3xl gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="size-5" />
              Customer sign in
            </CardTitle>
            <CardDescription>
              Use the same email you verified in Mailpit. Unverified accounts are redirected back
              into the verification flow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Field
                autoComplete="email"
                label="Email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
              <Field
                autoComplete="current-password"
                label="Password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />

              {error ? <InlineNotice message={error} tone="danger" /> : null}

              <div className="flex flex-wrap gap-3">
                <Button disabled={busy} type="submit">
                  {busy ? "Signing in..." : "Sign in"}
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link to="/forgot-password">Forgot password</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create a new account</CardTitle>
            <CardDescription>
              First-time owners create their account in customer-web and bootstrap their first
              organization after email verification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Sign-up collects your display name, email, password, organization name, and
              organization slug. Better Auth sends the verification email before the organization is
              created.
            </p>
            <Button asChild variant="outline">
              <Link to="/sign-up">
                Create account
                <ArrowRight className="size-4" />
              </Link>
            </Button>
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

function InlineNotice({
  message,
  tone,
}: {
  message: string;
  tone: "danger" | "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "success"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
        : tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
          : "border-border/70 bg-muted/50 text-foreground";

  return <div className={`rounded-xl border px-3 py-2 text-sm ${toneClass}`}>{message}</div>;
}
