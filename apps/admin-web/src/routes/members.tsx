import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, MailPlus, RefreshCw, TriangleAlert, UserPlus, Users } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

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
import { type LoadStatus, toErrorMessage } from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

type InviteRole = "admin" | "member";

type OrganizationMember = {
  id: string;
  role: string;
  createdAt: string | Date;
  user: {
    email: string;
    id: string;
    image?: string | null;
    name: string;
  };
};

type OrganizationInvitation = {
  createdAt: string | Date;
  email: string;
  expiresAt: string | Date;
  id: string;
  role: string;
  status: string;
};

const inputClassName =
  "w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";

const defaultInviteForm: { email: string; role: InviteRole } = {
  email: "",
  role: "member",
};

export const Route = createFileRoute("/members")({
  component: MembersRoute,
});

function MembersRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageMembers = activeRole === "owner" || activeRole === "admin";

  const [memberStatus, setMemberStatus] = useState<LoadStatus>("idle");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);

  const [inviteForm, setInviteForm] = useState(defaultInviteForm);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "danger" | "success" } | null>(
    null,
  );

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setMemberStatus("idle");
      setMemberError(null);
      setMembers([]);
      setInvitations([]);
      return;
    }

    void refreshMembers(activeOrganization.id);
  }, [activeOrganization?.id, session?.session.id]);

  const elevatedMembers = useMemo(
    () => members.filter((member) => ["owner", "admin"].includes(member.role)),
    [members],
  );
  const pendingInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === "pending"),
    [invitations],
  );

  async function refreshMembers(organizationId: string) {
    setMemberStatus("loading");
    setMemberError(null);

    try {
      const [membersResult, invitationsResult] = await Promise.all([
        authClient.organization.listMembers({
          query: {
            limit: 100,
            offset: 0,
            organizationId,
            sortBy: "createdAt",
            sortDirection: "asc",
          },
        }),
        authClient.organization.listInvitations({
          query: {
            organizationId,
          },
        }),
      ]);

      if (membersResult.error) {
        throw membersResult.error;
      }

      if (invitationsResult.error) {
        throw invitationsResult.error;
      }

      setMembers((membersResult.data?.members ?? []) as OrganizationMember[]);
      setInvitations((invitationsResult.data ?? []) as OrganizationInvitation[]);
      setMemberStatus("ready");
    } catch (caughtError) {
      setMemberStatus("error");
      setMemberError(toErrorMessage(caughtError, "Unable to load organization members."));
      setMembers([]);
      setInvitations([]);
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeOrganization?.id || !canManageMembers) {
      return;
    }

    setBusyAction("invite-member");
    setNotice(null);

    try {
      const result = await authClient.organization.inviteMember({
        email: inviteForm.email.trim().toLowerCase(),
        organizationId: activeOrganization.id,
        role: inviteForm.role,
      });

      if (result.error) {
        throw result.error;
      }

      setInviteForm(defaultInviteForm);
      await refreshMembers(activeOrganization.id);
      setNotice({
        message: "Invitation created.",
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to create invitation."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!activeOrganization?.id || !canManageMembers) {
      return;
    }

    setBusyAction(`cancel-${invitationId}`);
    setNotice(null);

    try {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      });

      if (result.error) {
        throw result.error;
      }

      await refreshMembers(activeOrganization.id);
      setNotice({
        message: "Invitation cancelled.",
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to cancel invitation."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResendInvitation(invitation: OrganizationInvitation) {
    if (!activeOrganization?.id || !canManageMembers) {
      return;
    }

    setBusyAction(`resend-${invitation.id}`);
    setNotice(null);

    try {
      const result = await authClient.organization.inviteMember({
        email: invitation.email,
        organizationId: activeOrganization.id,
        resend: true,
        role: invitation.role as InviteRole,
      });

      if (result.error) {
        throw result.error;
      }

      await refreshMembers(activeOrganization.id);
      setNotice({
        message: "Invitation resent.",
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to resend invitation."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Members"
      description="The member-management route now owns the invitation lifecycle as well as the roster: invite, resend, cancel, and role visibility."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh members"
            onClick={() =>
              activeOrganization?.id ? void refreshMembers(activeOrganization.id) : undefined
            }
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/members" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Members currently attached to the active organization."
          label="Members"
          tone={memberStatus === "error" ? "danger" : "success"}
          value={String(members.length)}
        />
        <StatCard
          detail="Owners and admins with elevated access."
          label="Elevated"
          tone={elevatedMembers.length > 0 ? "success" : "neutral"}
          value={String(elevatedMembers.length)}
        />
        <StatCard
          detail="Invitations still waiting to be accepted."
          label="Pending invites"
          tone={pendingInvitations.length > 0 ? "warning" : "neutral"}
          value={String(pendingInvitations.length)}
        />
        <StatCard
          detail="Role of the current Better Auth member."
          label="Your role"
          tone={activeRole ? "success" : "neutral"}
          value={activeRole ?? "unknown"}
        />
      </SectionGrid>

      {memberError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Member data unavailable
              </CardTitle>
              <CardDescription>{memberError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      {notice ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle>
                {notice.tone === "success" ? "Member action completed" : "Member action failed"}
              </CardTitle>
              <CardDescription>{notice.message}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailPlus className="size-5" />
              Invite member
            </CardTitle>
            <CardDescription>
              Create organization invitations directly from the member-management route.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void handleInvite(event)}>
              <LabeledField label="Invitee email">
                <input
                  className={inputClassName}
                  disabled={!canManageMembers}
                  onChange={(event) =>
                    setInviteForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="reviewer@example.com"
                  type="email"
                  value={inviteForm.email}
                />
              </LabeledField>
              <LabeledField label="Invitation role">
                <select
                  className={inputClassName}
                  disabled={!canManageMembers}
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      role: event.target.value as InviteRole,
                    }))
                  }
                  value={inviteForm.role}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </LabeledField>
              <Button
                disabled={
                  Boolean(busyAction) || !canManageMembers || inviteForm.email.trim().length === 0
                }
                type="submit"
              >
                <UserPlus className="size-4" />
                Send invitation
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" />
              Active roster
            </CardTitle>
            <CardDescription>
              The current organization membership list from Better Auth.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No members are visible for the active organization.
              </p>
            ) : (
              members.map((member) => (
                <div className="rounded-xl border p-3" key={member.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{member.user.name}</p>
                      <p className="text-sm text-muted-foreground">{member.user.email}</p>
                    </div>
                    <StatusPill tone={member.role === "member" ? "neutral" : "success"}>
                      {member.role}
                    </StatusPill>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="size-5" />
              Invitation queue
            </CardTitle>
            <CardDescription>
              Outstanding organization invitations with resend and cancel actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No invitations are pending for this organization.
              </p>
            ) : (
              invitations.map((invitation) => (
                <div className="rounded-xl border p-3" key={invitation.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-sm text-muted-foreground">
                        {invitation.role} • expires{" "}
                        {new Date(invitation.expiresAt).toLocaleString()}
                      </p>
                    </div>
                    <StatusPill tone={invitation.status === "pending" ? "warning" : "neutral"}>
                      {invitation.status}
                    </StatusPill>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      disabled={Boolean(busyAction) || !canManageMembers}
                      onClick={() => void handleResendInvitation(invitation)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Resend
                    </Button>
                    <Button
                      disabled={Boolean(busyAction) || !canManageMembers}
                      onClick={() => void handleCancelInvitation(invitation.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What this route proves</CardTitle>
            <CardDescription>Member management is no longer dashboard-only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              The roster, pending invitations, and invite mutations now live together on the
              member-management route.
            </p>
            <p>
              Invite proof still depends on the Better Auth mail flow and Mailpit, but the UI path
              is now route-level instead of hidden on the landing page.
            </p>
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function LabeledField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
