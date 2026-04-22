import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, LogOut, RefreshCw, UserRound } from "lucide-react";
import { useState } from "react";

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
import { CustomerRouteNavigation } from "../lib/customer-route-navigation";
import { toErrorMessage } from "../lib/customer-auth";

export const Route = createFileRoute("/account")({
  component: AccountRoute,
});

function AccountRoute() {
  const sessionQuery = authClient.useSession();
  const organizationsQuery = authClient.useListOrganizations();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data ?? null;
  const organizations = organizationsQuery.data ?? [];
  const activeOrganization = activeOrganizationQuery.data ?? null;

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);

  async function refreshEverything() {
    await Promise.all([
      sessionQuery.refetch(),
      organizationsQuery.refetch(),
      activeOrganizationQuery.refetch(),
    ]);
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

      await refreshEverything();
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

      await refreshEverything();
    });
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Account"
      description="A focused account route for the current Better Auth session, sign-out, and organization switching. Invitation browsing now lives on its own route."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh account"
            onClick={() => void refreshEverything()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          {session ? (
            <Button
              disabled={busyAction === "sign-out"}
              onClick={() => void handleSignOut()}
              type="button"
              variant="outline"
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          ) : null}
        </>
      }
    >
      <CustomerRouteNavigation currentPath="/account" />

      {notice ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle>
                {notice.tone === "success" ? "Account updated" : "Action failed"}
              </CardTitle>
              <CardDescription>{notice.message}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <StatCard
          detail={
            session ? `Signed in as ${session.user.email}.` : "No active Better Auth session."
          }
          label="Session"
          tone={session ? "success" : "neutral"}
          value={session ? "active" : "signed out"}
        />
        <StatCard
          detail="Organizations attached to the current account."
          label="Organizations"
          tone={organizations.length > 0 ? "success" : "neutral"}
          value={String(organizations.length)}
        />
        <StatCard
          detail="Current active organization for the session."
          label="Active organization"
          tone={activeOrganization ? "success" : "warning"}
          value={activeOrganization?.name ?? "none"}
        />
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-5" />
              Account session
            </CardTitle>
            <CardDescription>
              Identity and session state currently visible to customer-web.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {session ? (
              <>
                <AccountRow label="Name" value={session.user.name} />
                <AccountRow label="Email" value={session.user.email} />
                <AccountRow
                  label="Email verified"
                  value={session.user.emailVerified ? "Yes" : "No"}
                />
                <AccountRow label="Session id" value={session.session.id} />
              </>
            ) : (
              <p>No account session is active yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization switching</CardTitle>
            <CardDescription>
              Organizations available to this account and the active selection.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No organizations are attached to this account yet.
              </p>
            ) : (
              organizations.map((organization) => {
                const isActive = activeOrganization?.id === organization.id;

                return (
                  <div className="rounded-xl border p-3" key={organization.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{organization.name}</p>
                        <p className="text-sm text-muted-foreground">{organization.slug}</p>
                      </div>
                      <StatusPill tone={isActive ? "success" : "neutral"}>
                        {isActive ? "active" : "available"}
                      </StatusPill>
                    </div>
                    {!isActive ? (
                      <div className="mt-3">
                        <Button
                          disabled={busyAction === "set-active"}
                          onClick={() => void handleSetActiveOrganization(organization.id)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Set active
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitation inbox moved</CardTitle>
            <CardDescription>
              Invitation browsing is now a dedicated customer route instead of part of account
              management.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Use the invitation inbox for pending invites, accepted records, and direct links into
              the invite acceptance flow.
            </p>
            <Button asChild type="button" variant="outline">
              <Link to="/invitations">Open invitations</Link>
            </Button>
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
