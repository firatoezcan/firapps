import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, LoaderCircle } from "lucide-react";

import { AppPage, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import {
  clearOrgBootstrapDraft,
  readOrgBootstrapDraft,
  toErrorMessage,
} from "../lib/customer-auth";

export const Route = createFileRoute("/sign-up-complete")({
  component: SignUpCompletePage,
});

function SignUpCompletePage() {
  const navigate = useNavigate();
  const sessionQuery = authClient.useSession();
  const organizationsQuery = authClient.useListOrganizations();

  const [draft, setDraft] = useState(() => readOrgBootstrapDraft());
  const [status, setStatus] = useState<"idle" | "creating" | "ready" | "error">(
    draft ? "creating" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const attemptedCreationRef = useRef(false);

  const session = sessionQuery.data;
  const organizations = organizationsQuery.data ?? [];

  useEffect(() => {
    setDraft(readOrgBootstrapDraft());
  }, []);

  useEffect(() => {
    if (!session || !draft || attemptedCreationRef.current) {
      return;
    }

    if (organizations.length > 0) {
      clearOrgBootstrapDraft();
      attemptedCreationRef.current = true;
      setStatus("ready");
      return;
    }

    attemptedCreationRef.current = true;
    void createOrganization(draft.name, draft.slug);
  }, [draft, organizations.length, session]);

  async function createOrganization(name: string, slug: string) {
    setStatus("creating");
    setError(null);

    try {
      const result = await authClient.organization.create({
        keepCurrentActiveOrganization: false,
        name: name.trim(),
        slug: slug.trim(),
      });

      if (result.error) {
        throw result.error;
      }

      clearOrgBootstrapDraft();
      setDraft(null);
      setStatus("ready");
      await Promise.all([organizationsQuery.refetch(), sessionQuery.refetch()]);
    } catch (caughtError) {
      setError(
        toErrorMessage(
          caughtError,
          "The account is verified, but the organization could not be created.",
        ),
      );
      setStatus("error");
    }
  }

  async function handleRetry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft) {
      return;
    }

    attemptedCreationRef.current = true;
    await createOrganization(draft.name, draft.slug);
  }

  if (!session && !sessionQuery.isPending) {
    return (
      <AppPage
        eyebrow="Customer web"
        title="Verification finished, but no session is active"
        description="Open the verification link again from Mailpit or sign in with the verified account."
      >
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-sm text-muted-foreground">
                Better Auth did not expose a customer session in this browser yet.
              </p>
              <Button asChild variant="outline">
                <Link
                  search={{
                    email: "",
                    redirect: "/",
                  }}
                  to="/sign-in"
                >
                  Go to sign in
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Complete owner bootstrap"
      description="The account is verified. Customer-web now creates the first Better Auth organization and owner membership using the draft captured at sign-up."
    >
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              Organization bootstrap
            </CardTitle>
            <CardDescription>
              Verified account: {session?.user.email ?? "waiting for Better Auth session"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft ? (
              <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
                <p className="font-medium text-foreground">{draft.name}</p>
                <p className="mt-1 text-muted-foreground">{draft.slug}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No stored organization draft was found. If you verified an invite-only account,
                continue into the main customer workspace instead.
              </p>
            )}

            {status === "creating" ? (
              <InlineNotice
                message="Creating the Better Auth organization and owner membership..."
                tone="warning"
              />
            ) : null}

            {status === "error" && error ? <InlineNotice message={error} tone="danger" /> : null}

            {status === "ready" ? (
              <InlineNotice
                message="Organization bootstrap complete. Continue into the customer workspace."
                tone="success"
              />
            ) : null}

            {status === "error" && draft ? (
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleRetry}>
                <Field
                  label="Organization name"
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            name: event.target.value,
                          }
                        : current,
                    )
                  }
                  required
                  value={draft.name}
                />
                <Field
                  label="Organization slug"
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            slug: event.target.value,
                          }
                        : current,
                    )
                  }
                  required
                  value={draft.slug}
                />
                <div className="sm:col-span-2">
                  <Button type="submit">Retry organization creation</Button>
                </div>
              </form>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                disabled={status !== "ready"}
                onClick={() => void navigate({ to: "/" })}
                type="button"
              >
                Continue to customer home
                <ArrowRight className="size-4" />
              </Button>
              {status === "creating" ? (
                <Button disabled type="button" variant="outline">
                  <LoaderCircle className="size-4 animate-spin" />
                  Waiting for Better Auth
                </Button>
              ) : null}
            </div>
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
  tone: "danger" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";

  return <div className={`rounded-xl border px-3 py-2 text-sm ${toneClass}`}>{message}</div>;
}
