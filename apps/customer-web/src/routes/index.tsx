import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  LogOut,
  Megaphone,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";

import {
  AppPage,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SectionGrid,
  StatCard,
  StatusPill,
} from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import { toErrorMessage, toRoleLabel } from "../lib/customer-auth";

type Product = {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  status: string;
  featured: boolean;
};

type Announcement = {
  id: string;
  title: string;
  body: string;
  tone: "neutral" | "success" | "warning" | "danger";
};

type PublicApiState = {
  announcements: Announcement[];
  products: Product[];
};

type InvitationRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.organization.listUserInvitations>>["data"]
>[number];

type InvitationSummary = {
  id: InvitationRecord["id"];
  email: InvitationRecord["email"];
  role: InvitationRecord["role"];
  organizationId: InvitationRecord["organizationId"];
  organizationName?: string;
  status: InvitationRecord["status"];
  expiresAt: string;
};

const defaultState: PublicApiState = {
  announcements: [],
  products: [],
};

export const Route = createFileRoute("/")({ component: CustomerLanding });

function CustomerLanding() {
  const sessionQuery = authClient.useSession();
  const organizationsQuery = authClient.useListOrganizations();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data;
  const organizations = organizationsQuery.data ?? [];
  const activeOrganization = activeOrganizationQuery.data ?? null;

  const [state, setState] = useState<PublicApiState>(defaultState);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [invitationStatus, setInvitationStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function refresh() {
    setStatus("loading");
    setError(null);

    try {
      const [productsResponse, announcementsResponse] = await Promise.all([
        fetch(`${publicApiBasePath}/products`),
        fetch(`${publicApiBasePath}/announcements`),
      ]);

      if (!productsResponse.ok || !announcementsResponse.ok) {
        throw new Error(
          `public API returned ${productsResponse.status}/${announcementsResponse.status}`,
        );
      }

      const productsPayload = (await productsResponse.json()) as {
        products: Product[];
      };
      const announcementsPayload = (await announcementsResponse.json()) as {
        announcements: Announcement[];
      };

      setState({
        announcements: announcementsPayload.announcements,
        products: productsPayload.products,
      });
      setStatus("ready");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);

      setError(message);
      setStatus("error");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!session) {
      setInvitations([]);
      setInvitationStatus("idle");
      setInvitationError(null);
      return;
    }

    void refreshInvitations();
  }, [session?.session.id]);

  async function refreshAuthState() {
    await Promise.all([
      sessionQuery.refetch(),
      organizationsQuery.refetch(),
      activeOrganizationQuery.refetch(),
    ]);
  }

  async function refreshInvitations() {
    if (!session) {
      return;
    }

    setInvitationStatus("loading");
    setInvitationError(null);

    try {
      const result = await authClient.organization.listUserInvitations();

      if (result.error) {
        throw result.error;
      }

      setInvitations((result.data ?? []).map(toInvitationSummary));
      setInvitationStatus("ready");
    } catch (caughtError) {
      setInvitationError(
        toErrorMessage(caughtError, "Unable to load your Better Auth invitations."),
      );
      setInvitationStatus("error");
      setInvitations([]);
    }
  }

  async function refreshEverything() {
    await Promise.all([refresh(), refreshAuthState()]);

    if (session) {
      await refreshInvitations();
    }
  }

  async function runAction(actionKey: string, successMessage: string, action: () => Promise<void>) {
    setBusyAction(actionKey);
    setNotice(null);

    try {
      await action();
      setNotice({
        message: successMessage,
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "The request failed."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSignOut() {
    await runAction("sign-out", "Signed out.", async () => {
      const result = await authClient.signOut();

      if (result.error) {
        throw result.error;
      }

      setInvitations([]);
      await refreshAuthState();
    });
  }

  async function handleSetActiveOrganization(organizationId: string) {
    await runAction("set-active", "Active organization updated.", async () => {
      const result = await authClient.organization.setActive({
        organizationId,
      });

      if (result.error) {
        throw result.error;
      }

      await refreshAuthState();
    });
  }

  const featuredCount = state.products.filter((product) => product.featured).length;

  return (
    <AppPage
      eyebrow="Customer web"
      title="Better Auth customer workspace"
      description="Customer-facing account, organization, invitation, and catalog flow using Better Auth for session and membership state and the public Hono API for product content."
      actions={
        <>
          <Button onClick={() => void refreshEverything()} type="button" variant="outline">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          {session ? (
            <Button onClick={() => void handleSignOut()} type="button" variant="outline">
              <LogOut className="size-4" />
              Sign out
            </Button>
          ) : (
            <>
              <Button asChild type="button" variant="outline">
                <Link
                  search={{
                    email: "",
                    redirect: "/",
                  }}
                  to="/sign-in"
                >
                  Sign in
                </Link>
              </Button>
              <Button asChild type="button">
                <Link to="/sign-up">Create account</Link>
              </Button>
            </>
          )}
        </>
      }
    >
      {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          label="Session"
          value={session ? "active" : "signed out"}
          detail={session ? `Signed in as ${session.user.email}.` : "No Better Auth session yet."}
          tone={session ? "success" : "neutral"}
        />
        <StatCard
          label="Active organization"
          value={activeOrganization?.name ?? "none"}
          detail={
            activeOrganization
              ? `Slug ${activeOrganization.slug}.`
              : "Accept an invitation or finish owner bootstrap."
          }
          tone={activeOrganization ? "success" : "warning"}
        />
        <StatCard
          label="Accessible organizations"
          value={String(organizations.length)}
          detail="Organizations attached to the current Better Auth account."
          tone={organizations.length > 0 ? "success" : "neutral"}
        />
        <StatCard
          label="Pending invitations"
          value={String(invitations.filter((invitation) => invitation.status === "pending").length)}
          detail="Invitation records addressable through customer-web."
          tone={invitations.length > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Catalog products"
          value={String(state.products.length)}
          detail="Served by public-api over the shared API contract."
          tone={status === "error" ? "danger" : "neutral"}
        />
        <StatCard
          label="Featured products"
          value={String(featuredCount)}
          detail="Products marked as featured in the catalog schema."
          tone={featuredCount > 0 ? "success" : "warning"}
        />
        <StatCard
          label="Announcements"
          value={String(state.announcements.length)}
          detail="Ops-to-customer notices coming from the public API."
          tone={state.announcements.length > 0 ? "success" : "neutral"}
        />
      </SectionGrid>

      <SectionGrid>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5" />
                  Customer auth state
                </CardTitle>
                <CardDescription>
                  The customer app uses Better Auth directly instead of a parallel auth layer.
                </CardDescription>
              </div>
              <StatusPill tone={session ? "success" : "neutral"}>
                {session ? "authenticated" : "guest"}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {session ? (
              <>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="font-medium">{session.user.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{session.user.email}</p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Email verified: {session.user.emailVerified ? "yes" : "no"}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Organizations</p>
                    <StatusPill tone={organizations.length > 0 ? "success" : "warning"}>
                      {organizations.length}
                    </StatusPill>
                  </div>
                  {organizations.length > 0 ? (
                    <div className="space-y-3">
                      {organizations.map((organization) => {
                        const isActive = activeOrganization?.id === organization.id;

                        return (
                          <div
                            className="rounded-xl border border-border/60 bg-muted/20 p-4"
                            key={organization.id}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{organization.name}</p>
                                <p className="text-sm text-muted-foreground">{organization.slug}</p>
                              </div>
                              <Button
                                disabled={isActive || busyAction === "set-active"}
                                onClick={() => void handleSetActiveOrganization(organization.id)}
                                type="button"
                                variant={isActive ? "secondary" : "outline"}
                              >
                                {isActive ? "Active" : "Set active"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No organization memberships yet. Create the first organization from sign-up or
                      accept an invitation from the list below.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Customer-web owns owner sign-up, invite acceptance, verification follow-up, and
                  password reset.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <Link to="/sign-up">
                      Create owner account
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link
                      search={{
                        email: "",
                        redirect: "/",
                      }}
                      to="/sign-in"
                    >
                      Sign in
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-5" />
                  Invitations
                </CardTitle>
                <CardDescription>
                  Pending Better Auth invitations for the signed-in user.
                </CardDescription>
              </div>
              <StatusPill
                tone={
                  invitationStatus === "error"
                    ? "danger"
                    : invitationStatus === "loading"
                      ? "warning"
                      : invitations.length > 0
                        ? "warning"
                        : "neutral"
                }
              >
                {invitationStatus}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {session ? (
              <>
                {invitationError ? (
                  <p className="text-sm text-destructive">{invitationError}</p>
                ) : null}

                {invitations.length > 0 ? (
                  invitations.map((invitation) => (
                    <div
                      className="rounded-xl border border-border/60 bg-muted/20 p-4"
                      key={invitation.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {invitation.organizationName ?? invitation.organizationId}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Role: {toRoleLabel(invitation.role)}
                          </p>
                        </div>
                        <StatusPill tone={invitation.status === "pending" ? "warning" : "success"}>
                          {invitation.status}
                        </StatusPill>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button asChild type="button" variant="outline">
                          <Link params={{ invitationId: invitation.id }} to="/invite/$invitationId">
                            Open invitation
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No pending invitations for this account.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sign in with the invited email or open a direct invitation link from Mailpit.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <PackageSearch className="size-5" />
                  Catalog
                </CardTitle>
                <CardDescription>
                  Shared UI components rendering data from `public-api`.
                </CardDescription>
              </div>
              <StatusPill
                tone={status === "error" ? "danger" : status === "ready" ? "success" : "warning"}
              >
                {status}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.products.map((product) => (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4" key={product.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">{product.slug}</p>
                  </div>
                  <StatusPill tone={product.featured ? "success" : "neutral"}>
                    {product.status}
                  </StatusPill>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  EUR {(product.priceCents / 100).toFixed(2)}
                </p>
              </div>
            ))}

            {state.products.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {error ?? "No products returned yet."}
              </p>
            ) : null}

            <Button asChild type="button" variant="outline">
              <a href={`${publicApiBasePath}/products`} rel="noreferrer" target="_blank">
                Open products JSON
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="size-5" />
              Announcements
            </CardTitle>
            <CardDescription>Customer-facing updates seeded by the public API.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.announcements.map((announcement) => (
              <div
                className="rounded-xl border border-border/60 bg-muted/20 p-4"
                key={announcement.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{announcement.title}</p>
                  <StatusPill tone={announcement.tone}>{announcement.tone}</StatusPill>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{announcement.body}</p>
              </div>
            ))}

            {state.announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {error ?? "No announcements returned yet."}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </SectionGrid>
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

function toInvitationSummary(invitation: InvitationRecord): InvitationSummary {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    organizationId: invitation.organizationId,
    organizationName: invitation.organization?.name ?? undefined,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

const publicApiBasePath = "/api/public";
