import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  Building2,
  LogIn,
  LogOut,
  MailPlus,
  RefreshCw,
  ServerCog,
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
  cn,
} from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";

type SessionData = {
  session: {
    id: string;
    activeOrganizationId?: string | null;
  };
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
  };
};

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  createdAt: string | Date;
  logo?: string | null;
  metadata?: Record<string, unknown> | null;
};

type OrganizationMember = {
  id: string;
  organizationId: string;
  role: string;
  createdAt: string | Date;
  userId: string;
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
};

type OrganizationInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  inviterId: string;
  expiresAt: string | Date;
  createdAt: string | Date;
};

type Tenant = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
};

type Deployment = {
  id: string;
  tenantId: string;
  environment: string;
  version: string;
  status: string;
};

type OperationsState = {
  deployments: Deployment[];
  tenants: Tenant[];
};

type OrganizationViewState = {
  invitations: OrganizationInvitation[];
  members: OrganizationMember[];
  totalMembers: number;
};

type LoadStatus = "idle" | "loading" | "ready" | "error" | "unauthorized";
type NoticeTone = "danger" | "neutral" | "success" | "warning";
type InviteRole = "admin" | "member";

const defaultOperationsState: OperationsState = {
  deployments: [],
  tenants: [],
};

const defaultOrganizationViewState: OrganizationViewState = {
  invitations: [],
  members: [],
  totalMembers: 0,
};

const defaultSignInForm = {
  email: "",
  password: "",
};

const defaultCreateOrganizationForm = {
  name: "",
  slug: "",
};

const defaultInviteForm: { email: string; role: InviteRole } = {
  email: "",
  role: "member",
};

export const Route = createFileRoute("/")({ component: AdminLanding });

function AdminLanding() {
  const sessionQuery = authClient.useSession();
  const organizationsQuery = authClient.useListOrganizations();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberQuery = authClient.useActiveMember();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = (sessionQuery.data ?? null) as SessionData | null;
  const organizations = (organizationsQuery.data ?? []) as OrganizationSummary[];
  const activeOrganization = (activeOrganizationQuery.data ?? null) as OrganizationSummary | null;
  const activeMember = (activeMemberQuery.data ?? null) as OrganizationMember | null;
  const activeMemberRole = ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role;

  const [operationsState, setOperationsState] = useState<OperationsState>(defaultOperationsState);
  const [operationsStatus, setOperationsStatus] = useState<LoadStatus>("idle");
  const [operationsError, setOperationsError] = useState<string | null>(null);

  const [organizationState, setOrganizationState] = useState<OrganizationViewState>(
    defaultOrganizationViewState,
  );
  const [organizationStatus, setOrganizationStatus] = useState<LoadStatus>("idle");
  const [organizationError, setOrganizationError] = useState<string | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: NoticeTone;
  } | null>(null);

  const [signInForm, setSignInForm] = useState(defaultSignInForm);
  const [createOrganizationForm, setCreateOrganizationForm] = useState(
    defaultCreateOrganizationForm,
  );
  const [organizationSlugDirty, setOrganizationSlugDirty] = useState(false);
  const [inviteForm, setInviteForm] = useState(defaultInviteForm);

  const currentRole = activeMemberRole ?? activeMember?.role ?? null;
  const canManageMembers = currentRole === "admin" || currentRole === "owner";
  const organizationAccessPending =
    organizationsQuery.isPending ||
    activeOrganizationQuery.isPending ||
    activeMemberQuery.isPending ||
    activeMemberRoleQuery.isPending;
  const pendingInvitations = organizationState.invitations.filter(
    (invitation) => invitation.status === "pending",
  );
  const readyDeployments = operationsState.deployments.filter(
    (deployment) => deployment.status === "ready",
  ).length;

  useEffect(() => {
    if (!session) {
      setOperationsState(defaultOperationsState);
      setOperationsStatus("idle");
      setOperationsError(null);
      return;
    }

    void refreshOperationsData();
  }, [session?.session.id]);

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setOrganizationState(defaultOrganizationViewState);
      setOrganizationStatus(organizations.length > 0 ? "idle" : "ready");
      setOrganizationError(null);
      return;
    }

    void refreshOrganizationData(activeOrganization.id);
  }, [activeOrganization?.id, organizations.length, session?.session.id]);

  async function refreshOperationsData() {
    if (!session) {
      return;
    }

    setOperationsStatus("loading");
    setOperationsError(null);

    try {
      const [tenantsResponse, deploymentsResponse] = await Promise.all([
        fetch(`${internalApiBasePath}/tenants`, {
          credentials: "include",
        }),
        fetch(`${internalApiBasePath}/deployments`, {
          credentials: "include",
        }),
      ]);

      if (tenantsResponse.status === 401 || deploymentsResponse.status === 401) {
        throw new Error("Internal API rejected the current Better Auth session.");
      }

      if (tenantsResponse.status === 403 || deploymentsResponse.status === 403) {
        throw new Error("Internal API denied access for the current session.");
      }

      if (!tenantsResponse.ok || !deploymentsResponse.ok) {
        throw new Error(
          `internal API returned ${tenantsResponse.status}/${deploymentsResponse.status}`,
        );
      }

      const tenantsPayload = (await tenantsResponse.json()) as {
        tenants: Tenant[];
      };
      const deploymentsPayload = (await deploymentsResponse.json()) as {
        deployments: Deployment[];
      };

      setOperationsState({
        deployments: deploymentsPayload.deployments,
        tenants: tenantsPayload.tenants,
      });
      setOperationsStatus("ready");
    } catch (caughtError) {
      const message = toErrorMessage(caughtError, "Unable to load tenant and deployment data.");

      setOperationsError(message);
      setOperationsStatus(
        message.includes("rejected") || message.includes("denied") ? "unauthorized" : "error",
      );
      setOperationsState(defaultOperationsState);
    }
  }

  async function refreshOrganizationData(organizationId: string) {
    setOrganizationStatus("loading");
    setOrganizationError(null);

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

      setOrganizationState({
        invitations: invitationsResult.data ?? [],
        members: membersResult.data?.members ?? [],
        totalMembers: membersResult.data?.total ?? 0,
      });
      setOrganizationStatus("ready");
    } catch (caughtError) {
      setOrganizationError(toErrorMessage(caughtError, "Unable to load organization state."));
      setOrganizationStatus("error");
      setOrganizationState(defaultOrganizationViewState);
    }
  }

  async function refreshAuthState() {
    await Promise.all([
      sessionQuery.refetch(),
      organizationsQuery.refetch(),
      activeOrganizationQuery.refetch(),
      activeMemberQuery.refetch(),
      activeMemberRoleQuery.refetch(),
    ]);
  }

  async function refreshEverything() {
    await refreshAuthState();

    if (session) {
      await refreshOperationsData();
    }

    if (activeOrganization?.id) {
      await refreshOrganizationData(activeOrganization.id);
    }
  }

  async function runAction(
    actionKey: string,
    onSuccessMessage: string,
    action: () => Promise<void>,
  ) {
    setBusyAction(actionKey);
    setNotice(null);

    try {
      await action();
      setNotice({
        message: onSuccessMessage,
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

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("sign-in", "Signed in to the admin control plane.", async () => {
      const result = await authClient.signIn.email({
        email: signInForm.email.trim(),
        password: signInForm.password,
      });

      if (result.error) {
        throw result.error;
      }

      setSignInForm((current) => ({
        ...current,
        password: "",
      }));

      await refreshAuthState();
    });
  }

  async function handleSignOut() {
    await runAction("sign-out", "Signed out.", async () => {
      const result = await authClient.signOut();

      if (result.error) {
        throw result.error;
      }

      setOrganizationState(defaultOrganizationViewState);
      setOperationsState(defaultOperationsState);
      setOperationsStatus("idle");
      setOrganizationStatus("idle");
      await refreshAuthState();
    });
  }

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("create-organization", "Organization created and set active.", async () => {
      const result = await authClient.organization.create({
        keepCurrentActiveOrganization: false,
        name: createOrganizationForm.name.trim(),
        slug: createOrganizationForm.slug.trim(),
      });

      if (result.error) {
        throw result.error;
      }

      setCreateOrganizationForm(defaultCreateOrganizationForm);
      setOrganizationSlugDirty(false);

      await refreshEverything();
    });
  }

  async function handleSwitchOrganization(organizationId: string) {
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

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeOrganization?.id) {
      return;
    }

    await runAction("invite-member", "Invitation created.", async () => {
      const result = await authClient.organization.inviteMember({
        email: inviteForm.email.trim().toLowerCase(),
        organizationId: activeOrganization.id,
        role: inviteForm.role,
      });

      if (result.error) {
        throw result.error;
      }

      setInviteForm(defaultInviteForm);
      await refreshOrganizationData(activeOrganization.id);
      await refreshAuthState();
    });
  }

  async function handleCancelInvitation(invitationId: string) {
    await runAction("cancel-invitation", "Invitation cancelled.", async () => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      });

      if (result.error) {
        throw result.error;
      }

      if (activeOrganization?.id) {
        await refreshOrganizationData(activeOrganization.id);
      }
    });
  }

  async function handleResendInvitation(invitation: OrganizationInvitation) {
    if (!activeOrganization?.id) {
      return;
    }

    await runAction("resend-invitation", "Invitation resent.", async () => {
      const result = await authClient.organization.inviteMember({
        email: invitation.email,
        organizationId: activeOrganization.id,
        resend: true,
        role: invitation.role as InviteRole,
      });

      if (result.error) {
        throw result.error;
      }

      await refreshOrganizationData(activeOrganization.id);
    });
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Better Auth admin control plane"
      description="Session-aware organization bootstrap, membership administration, and internal operations visibility wired to Better Auth and internal-api."
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
          ) : null}
        </>
      }
    >
      {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail={session ? `Signed in as ${session.user.email}.` : "No Better Auth session yet."}
          label="Session"
          tone={sessionQuery.isPending ? "warning" : session ? "success" : "neutral"}
          value={session ? "active" : "signed out"}
        />
        <StatCard
          detail="Organizations from Better Auth."
          label="Organizations"
          tone={organizations.length > 0 ? "success" : "neutral"}
          value={String(organizations.length)}
        />
        <StatCard
          detail={
            activeOrganization
              ? `Pending invitations in ${activeOrganization.name}.`
              : "Select or create an organization first."
          }
          label="Pending invites"
          tone={pendingInvitations.length > 0 ? "warning" : "neutral"}
          value={String(pendingInvitations.length)}
        />
        <StatCard
          detail="Internal deployments visible through /api/internal."
          label="Ready deployments"
          tone={readyDeployments > 0 ? "success" : "neutral"}
          value={String(readyDeployments)}
        />
      </SectionGrid>

      {!session ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LogIn className="size-5" />
                Sign in
              </CardTitle>
              <CardDescription>
                Use an existing Better Auth email/password account to unlock the admin organization
                and operations views.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={(event) => void handleSignIn(event)}>
                <LabeledField label="Email">
                  <input
                    autoComplete="email"
                    className={inputClassName}
                    onChange={(event) =>
                      setSignInForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="owner@example.com"
                    type="email"
                    value={signInForm.email}
                  />
                </LabeledField>
                <LabeledField label="Password">
                  <input
                    autoComplete="current-password"
                    className={inputClassName}
                    onChange={(event) =>
                      setSignInForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    placeholder="Enter the Better Auth password"
                    type="password"
                    value={signInForm.password}
                  />
                </LabeledField>
                <div className="flex items-center gap-3">
                  <Button
                    disabled={
                      Boolean(busyAction) ||
                      signInForm.email.trim().length === 0 ||
                      signInForm.password.length === 0
                    }
                    type="submit"
                  >
                    <LogIn className="size-4" />
                    Sign in
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Signed-out users cannot query `/api/internal/*`.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5" />
                Signed-out behavior
              </CardTitle>
              <CardDescription>
                The admin shell stays readable when no Better Auth session exists, but organization
                actions and internal API calls remain blocked.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Once a session is created, the shell hydrates organization state, member and
                invitation lists, and the internal operations endpoint data.
              </p>
              <p>
                If the session is valid but `/api/internal/*` still denies access, this page reports
                that separately as an authorization problem.
              </p>
            </CardContent>
          </Card>
        </SectionGrid>
      ) : (
        <>
          <SectionGrid>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <ShieldCheck className="size-5" />
                      Session overview
                    </CardTitle>
                    <CardDescription>
                      Better Auth is the canonical session and organization source for the admin
                      shell.
                    </CardDescription>
                  </div>
                  <StatusPill tone={session.user.emailVerified ? "success" : "warning"}>
                    {session.user.emailVerified ? "verified" : "unverified"}
                  </StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium">{session.user.name || "Unnamed user"}</p>
                <p className="text-muted-foreground">{session.user.email}</p>
                <p className="text-muted-foreground">
                  Current role: {currentRole ?? "no active membership"}
                </p>
                <p className="text-muted-foreground">
                  Active organization: {activeOrganization?.name ?? "none selected"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="size-5" />
                  Organization access
                </CardTitle>
                <CardDescription>
                  Switch the active Better Auth organization when the account belongs to more than
                  one.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {organizations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No organizations yet. Create the first one below to bootstrap the account into
                    an owner workflow.
                  </p>
                ) : (
                  organizations.map((organization) => {
                    const isActive = activeOrganization?.id === organization.id;

                    return (
                      <div
                        className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-4"
                        key={organization.id}
                      >
                        <div>
                          <p className="font-medium">{organization.name}</p>
                          <p className="text-sm text-muted-foreground">{organization.slug}</p>
                        </div>
                        <Button
                          disabled={Boolean(busyAction) || isActive}
                          onClick={() => void handleSwitchOrganization(organization.id)}
                          type="button"
                          variant={isActive ? "secondary" : "outline"}
                        >
                          {isActive ? "Active" : "Set active"}
                        </Button>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </SectionGrid>

          {organizationAccessPending ? (
            <SectionGrid>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="size-5" />
                    Loading organization access
                  </CardTitle>
                  <CardDescription>
                    Resolving organizations, active membership, and the current Better Auth role.
                  </CardDescription>
                </CardHeader>
              </Card>
            </SectionGrid>
          ) : organizations.length === 0 ? (
            <SectionGrid>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="size-5" />
                    Bootstrap organization
                  </CardTitle>
                  <CardDescription>
                    Create the first organization for this account. Better Auth will make the
                    creator the owner and active member.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-4"
                    onSubmit={(event) => void handleCreateOrganization(event)}
                  >
                    <LabeledField label="Organization name">
                      <input
                        className={inputClassName}
                        onChange={(event) => {
                          const nextName = event.target.value;

                          setCreateOrganizationForm((current) => ({
                            name: nextName,
                            slug: organizationSlugDirty ? current.slug : slugify(nextName),
                          }));
                        }}
                        placeholder="Northwind Ops"
                        type="text"
                        value={createOrganizationForm.name}
                      />
                    </LabeledField>
                    <LabeledField label="Slug">
                      <input
                        className={inputClassName}
                        onChange={(event) => {
                          setOrganizationSlugDirty(true);
                          setCreateOrganizationForm((current) => ({
                            ...current,
                            slug: slugify(event.target.value),
                          }));
                        }}
                        placeholder="northwind-ops"
                        type="text"
                        value={createOrganizationForm.slug}
                      />
                    </LabeledField>
                    <Button
                      disabled={
                        Boolean(busyAction) ||
                        createOrganizationForm.name.trim().length === 0 ||
                        createOrganizationForm.slug.trim().length === 0
                      }
                      type="submit"
                    >
                      <Building2 className="size-4" />
                      Create organization
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </SectionGrid>
          ) : (
            <>
              <SectionGrid className="xl:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="size-5" />
                      Organization overview
                    </CardTitle>
                    <CardDescription>
                      Active organization summary plus Better Auth membership counts.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {activeOrganization ? (
                      <>
                        <p className="font-medium">{activeOrganization.name}</p>
                        <p className="text-muted-foreground">Slug: {activeOrganization.slug}</p>
                        <p className="text-muted-foreground">
                          Created: {formatDate(activeOrganization.createdAt)}
                        </p>
                        <p className="text-muted-foreground">
                          Members: {organizationState.totalMembers}
                        </p>
                        <p className="text-muted-foreground">
                          Pending invitations: {pendingInvitations.length}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">No active organization selected.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="size-5" />
                      Member access
                    </CardTitle>
                    <CardDescription>
                      This UI stays editable only for owner/admin memberships in the active
                      organization.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>Active role: {currentRole ?? "none"}</p>
                    <p>Invitation controls: {canManageMembers ? "enabled" : "read only"}</p>
                    <p>
                      Member listing stays visible even when the current role cannot create or
                      cancel invitations.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MailPlus className="size-5" />
                      Invite member
                    </CardTitle>
                    <CardDescription>
                      Create a Better Auth organization invitation for the active organization.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => void handleInviteMember(event)}
                    >
                      <LabeledField label="Invitee email">
                        <input
                          className={inputClassName}
                          disabled={!canManageMembers}
                          onChange={(event) =>
                            setInviteForm((current) => ({
                              ...current,
                              email: event.target.value,
                            }))
                          }
                          placeholder="teammate@example.com"
                          type="email"
                          value={inviteForm.email}
                        />
                      </LabeledField>
                      <LabeledField label="Role">
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
                          Boolean(busyAction) ||
                          !canManageMembers ||
                          inviteForm.email.trim().length === 0 ||
                          !activeOrganization
                        }
                        type="submit"
                      >
                        <MailPlus className="size-4" />
                        Send invitation
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </SectionGrid>

              <SectionGrid>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2">
                          <Users className="size-5" />
                          Members
                        </CardTitle>
                        <CardDescription>
                          Better Auth membership records for the active organization.
                        </CardDescription>
                      </div>
                      <StatusPill tone={statusTone(organizationStatus)}>
                        {organizationStatus}
                      </StatusPill>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {organizationError ? (
                      <InlineNotice message={organizationError} tone="danger" />
                    ) : null}

                    {organizationState.members.map((member) => (
                      <div
                        className="rounded-xl border border-border/60 bg-muted/20 p-4"
                        key={member.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{member.user.name || member.user.email}</p>
                            <p className="text-sm text-muted-foreground">{member.user.email}</p>
                          </div>
                          <StatusPill tone={roleTone(member.role)}>{member.role}</StatusPill>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Added: {formatDate(member.createdAt)}
                        </p>
                      </div>
                    ))}

                    {organizationState.members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No members returned for the active organization yet.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MailPlus className="size-5" />
                      Pending invitations
                    </CardTitle>
                    <CardDescription>
                      Pending Better Auth invitations for the active organization, including cancel
                      and resend flows.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {pendingInvitations.map((invitation) => (
                      <div
                        className="rounded-xl border border-border/60 bg-muted/20 p-4"
                        key={invitation.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{invitation.email}</p>
                            <p className="text-sm text-muted-foreground">Role: {invitation.role}</p>
                          </div>
                          <StatusPill tone="warning">{invitation.status}</StatusPill>
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                          <p>Created: {formatDate(invitation.createdAt)}</p>
                          <p>Expires: {formatDate(invitation.expiresAt)}</p>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            disabled={Boolean(busyAction) || !canManageMembers}
                            onClick={() => void handleResendInvitation(invitation)}
                            type="button"
                            variant="outline"
                          >
                            Resend
                          </Button>
                          <Button
                            disabled={Boolean(busyAction) || !canManageMembers}
                            onClick={() => void handleCancelInvitation(invitation.id)}
                            type="button"
                            variant="destructive"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ))}

                    {pendingInvitations.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No pending invitations for the active organization.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </SectionGrid>
            </>
          )}

          <SectionGrid className="xl:grid-cols-3">
            <StatCard
              detail={
                operationsStatus === "unauthorized"
                  ? "The session exists, but /api/internal refused it."
                  : "Rows owned by the operations schema."
              }
              label="Tenants"
              tone={
                operationsStatus === "unauthorized"
                  ? "warning"
                  : operationsState.tenants.length > 0
                    ? "success"
                    : "neutral"
              }
              value={String(operationsState.tenants.length)}
            />
            <StatCard
              detail="Cross-environment deployment records from internal-api."
              label="Deployments"
              tone={
                operationsStatus === "error"
                  ? "danger"
                  : operationsStatus === "unauthorized"
                    ? "warning"
                    : "neutral"
              }
              value={String(operationsState.deployments.length)}
            />
            <StatCard
              detail="Deployments currently reporting a ready state."
              label="Ready deployments"
              tone={readyDeployments > 0 ? "success" : "neutral"}
              value={String(readyDeployments)}
            />
          </SectionGrid>

          <SectionGrid>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="size-5" />
                      Tenant inventory
                    </CardTitle>
                    <CardDescription>
                      Tenant data stays visible, but only after a valid Better Auth session unlocks
                      the internal API.
                    </CardDescription>
                  </div>
                  <StatusPill tone={statusTone(operationsStatus)}>{operationsStatus}</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {operationsError ? <InlineNotice message={operationsError} tone="warning" /> : null}

                {operationsState.tenants.map((tenant) => (
                  <div
                    className="rounded-xl border border-border/60 bg-muted/20 p-4"
                    key={tenant.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{tenant.name}</p>
                        <p className="text-sm text-muted-foreground">{tenant.slug}</p>
                      </div>
                      <StatusPill tone={tenantTone(tenant.status)}>{tenant.status}</StatusPill>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Plan: {tenant.plan}</p>
                  </div>
                ))}

                {operationsState.tenants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {operationsError ?? "No tenants returned yet."}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ServerCog className="size-5" />
                  Release activity
                </CardTitle>
                <CardDescription>
                  Deployment records from the protected internal API.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {operationsState.deployments.map((deployment) => (
                  <div
                    className="rounded-xl border border-border/60 bg-muted/20 p-4"
                    key={deployment.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{deployment.environment}</p>
                        <p className="text-sm text-muted-foreground">
                          Tenant: {deployment.tenantId}
                        </p>
                      </div>
                      <StatusPill tone={deploymentTone(deployment.status)}>
                        {deployment.status}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Version: {deployment.version}
                    </p>
                  </div>
                ))}

                {operationsState.deployments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {operationsError ?? "No deployments returned yet."}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </SectionGrid>
        </>
      )}
    </AppPage>
  );
}

function LabeledField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function InlineNotice({ message, tone }: { message: string; tone: NoticeTone }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "success" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
        tone === "warning" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
        tone === "danger" && "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-100",
        tone === "neutral" && "border-border/60 bg-muted/30 text-foreground",
      )}
    >
      {message}
    </div>
  );
}

function toErrorMessage(caughtError: unknown, fallback: string) {
  if (caughtError instanceof Error && caughtError.message) {
    return caughtError.message;
  }

  if (
    typeof caughtError === "object" &&
    caughtError !== null &&
    "message" in caughtError &&
    typeof caughtError.message === "string"
  ) {
    return caughtError.message;
  }

  return fallback;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "unknown";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function statusTone(status: LoadStatus) {
  switch (status) {
    case "ready":
      return "success";
    case "error":
      return "danger";
    case "unauthorized":
    case "loading":
      return "warning";
    default:
      return "neutral";
  }
}

function roleTone(role: string) {
  if (role === "owner") {
    return "success";
  }

  if (role === "admin") {
    return "warning";
  }

  return "neutral";
}

function deploymentTone(status: string) {
  if (status === "ready") {
    return "success";
  }

  if (status === "pending") {
    return "warning";
  }

  return "neutral";
}

function tenantTone(status: string) {
  if (status === "healthy") {
    return "success";
  }

  if (status === "migrating") {
    return "warning";
  }

  return "neutral";
}

const inputClassName =
  "h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60";

const internalApiBasePath = "/api/internal";
