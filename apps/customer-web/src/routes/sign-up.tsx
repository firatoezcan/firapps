import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { AppPage, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import {
  buildCustomerPath,
  buildCustomerUrl,
  storeOrgBootstrapDraft,
  toErrorMessage,
} from "../lib/customer-auth";

export const Route = createFileRoute("/sign-up")({ component: SignUpPage });

function SignUpPage() {
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [organizationSlugDirty, setOrganizationSlugDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (organizationSlugDirty) {
      return;
    }

    setOrganizationSlug(slugify(organizationName));
  }, [organizationName, organizationSlugDirty]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedDraft = {
        name: organizationName.trim(),
        slug: organizationSlug.trim(),
      };

      const result = await authClient.signUp.email({
        callbackURL: buildCustomerUrl("/sign-up-complete"),
        email: normalizedEmail,
        name: displayName.trim(),
        password,
      });

      if (result.error) {
        throw result.error;
      }

      storeOrgBootstrapDraft(normalizedDraft);
      await navigate({
        to: "/verification-pending",
        search: {
          email: normalizedEmail,
          next: buildCustomerPath("/sign-up-complete"),
        },
      });
    } catch (caughtError) {
      setError(toErrorMessage(caughtError, "Unable to create the account."));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Create the first customer account"
      description="Better Auth owns the account, verification, and follow-up organization bootstrap. The organization is created after the email link is completed."
    >
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5" />
              Owner sign-up
            </CardTitle>
            <CardDescription>
              This is the local SaaS bootstrap path: verify the account in Mailpit, then
              customer-web finishes the organization creation and owner membership.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
              <Field
                autoComplete="name"
                label="Display name"
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
              <Field
                autoComplete="email"
                label="Email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
              <Field
                autoComplete="new-password"
                hint="Minimum eight characters."
                label="Password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <div />
              <Field
                label="Organization name"
                onChange={(event) => setOrganizationName(event.target.value)}
                required
                value={organizationName}
              />
              <Field
                label="Organization slug"
                onChange={(event) => {
                  setOrganizationSlugDirty(true);
                  setOrganizationSlug(event.target.value);
                }}
                required
                value={organizationSlug}
              />

              {error ? (
                <div className="sm:col-span-2">
                  <InlineNotice message={error} tone="danger" />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <Button disabled={busy} type="submit">
                  {busy ? "Creating account..." : "Create account"}
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link
                    search={{
                      email: "",
                      redirect: "/",
                    }}
                    to="/sign-in"
                  >
                    Already have an account
                    <ArrowRight className="size-4" />
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

function Field({
  hint,
  label,
  ...props
}: {
  hint?: string;
  label: string;
} & Omit<React.ComponentProps<"input">, "className">) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        className="h-11 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-primary/15"
        {...props}
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
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

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
