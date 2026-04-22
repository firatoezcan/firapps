import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, MailPlus, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { CustomerRouteNavigation } from "../lib/customer-route-navigation";

type InvitationRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.organization.listUserInvitations>>["data"]
>[number];

type InvitationSummary = {
  email: InvitationRecord["email"];
  expiresAt: string;
  id: InvitationRecord["id"];
  organizationId: InvitationRecord["organizationId"];
  organizationName?: string;
  role: InvitationRecord["role"];
  status: InvitationRecord["status"];
};

export const Route = createFileRoute("/invitations")({
  component: InvitationsRoute,
});

function InvitationsRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data ?? null;
  const activeOrganization = activeOrganizationQuery.data ?? null;

  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);

  useEffect(() => {
    if (!session) {
      setLoadStatus("idle");
      setLoadError(null);
      setInvitations([]);
      return;
    }

    void refreshInvitations();
  }, [session?.session.id]);

  const pendingInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === "pending"),
    [invitations],
  );
  const acceptedInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === "accepted"),
    [invitations],
  );
  const inactiveInvitations = useMemo(
    () =>
      invitations.filter(
        (invitation) => !["accepted", "pending"].includes(invitation.status.toLowerCase()),
      ),
    [invitations],
  );

  async function refreshInvitations() {
    if (!session) {
      return;
    }

    setLoadStatus("loading");
    setLoadError(null);

    try {
      const result = await authClient.organization.listUserInvitations();

      if (result.error) {
        throw result.error;
      }

      setInvitations((result.data ?? []).map(toInvitationSummary));
      setLoadStatus("ready");
    } catch (caughtError) {
      setLoadStatus("error");
      setLoadError(toErrorMessage(caughtError, "Unable to load your invitation inbox."));
      setInvitations([]);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Invitations"
      description="A first-class invitation inbox for the signed-in member. This route keeps Better Auth invitation browsing separate from account/session management."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button asChild type="button" variant="outline">
            <Link to="/account">Account</Link>
          </Button>
          <Button
            aria-label="Refresh invitations"
            onClick={() => void refreshInvitations()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <CustomerRouteNavigation currentPath="/invitations" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Invitation records currently visible to your Better Auth session."
          label="Visible invitations"
          tone={invitations.length > 0 ? "success" : loadStatus === "error" ? "danger" : "neutral"}
          value={String(invitations.length)}
        />
        <StatCard
          detail="Invitation records that still need a response."
          label="Pending"
          tone={pendingInvitations.length > 0 ? "warning" : "neutral"}
          value={String(pendingInvitations.length)}
        />
        <StatCard
          detail="Previously accepted invitations still visible on the account."
          label="Accepted"
          tone={acceptedInvitations.length > 0 ? "success" : "neutral"}
          value={String(acceptedInvitations.length)}
        />
        <StatCard
          detail="Current active organization on this session."
          label="Active organization"
          tone={activeOrganization ? "success" : "warning"}
          value={activeOrganization?.name ?? "none"}
        />
      </SectionGrid>

      {loadError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Invitation inbox unavailable
              </CardTitle>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailPlus className="size-5" />
              Invitation inbox
            </CardTitle>
            <CardDescription>
              Each record links into the dedicated invitation flow at `/invite/$invitationId`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!session ? (
              <p className="text-sm text-muted-foreground">
                Sign in with the invited email to load your Better Auth invitations here.
              </p>
            ) : loadStatus === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading invitations…</p>
            ) : invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No invitation records are visible for this account right now.
              </p>
            ) : (
              invitations.map((invitation) => (
                <div className="rounded-xl border p-4" key={invitation.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {invitation.organizationName ?? invitation.organizationId}
                      </p>
                      <p className="text-sm text-muted-foreground">{invitation.email}</p>
                    </div>
                    <StatusPill tone={invitation.status === "pending" ? "warning" : "success"}>
                      {invitation.status}
                    </StatusPill>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                    <InvitationField label="Role" value={toRoleLabel(invitation.role)} />
                    <InvitationField
                      label="Expires"
                      value={new Date(invitation.expiresAt).toLocaleString()}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button asChild size="sm" type="button" variant="outline">
                      <Link params={{ invitationId: invitation.id }} to="/invite/$invitationId">
                        Open invitation
                      </Link>
                    </Button>
                    {activeOrganization?.id === invitation.organizationId ? (
                      <StatusPill tone="success">Current organization</StatusPill>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scope</CardTitle>
            <CardDescription>
              Invitations stay on their own route so `/account` can stay focused on account,
              session, and organization switching.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Pending invites still originate from Mailpit/email links, but this inbox is now the
              first-class customer-web place to review them after sign-in.
            </p>
            <p>
              Need the full acceptance or account bootstrap flow? Open the invitation card to jump
              into the per-invite route.
            </p>
            {inactiveInvitations.length > 0 ? (
              <p>{inactiveInvitations.length} invitation records are already closed or inactive.</p>
            ) : null}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function InvitationField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function toInvitationSummary(invitation: InvitationRecord): InvitationSummary {
  return {
    email: invitation.email,
    expiresAt: new Date(invitation.expiresAt).toISOString(),
    id: invitation.id,
    organizationId: invitation.organizationId,
    organizationName: invitation.organization?.name ?? invitation.organizationName ?? undefined,
    role: invitation.role,
    status: invitation.status,
  };
}
