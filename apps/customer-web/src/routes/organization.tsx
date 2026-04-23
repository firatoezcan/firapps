import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  ClipboardList,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
  TriangleAlert,
  Users,
} from "lucide-react";
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
import { CustomerRouteNavigation } from "../lib/customer-route-navigation";
import { toErrorMessage, toRoleLabel } from "../lib/customer-auth";
import {
  clearCustomerMemberRunsSnapshot,
  clearCustomerProjectsSnapshot,
  clearCustomerWorkspacesSnapshot,
  refreshCustomerMemberRunsSnapshot,
  refreshCustomerProjectsSnapshot,
  refreshCustomerWorkspacesSnapshot,
  useCustomerMemberRunsCollection,
  useCustomerProjectsCollection,
  useCustomerWorkspacesCollection,
  type MemberRunScope,
} from "../lib/customer-product-data";
import {
  type LoadStatus,
  formatDate,
  getRunPullRequestUrl,
  projectTone,
  runTone,
  workspaceIsReady,
  workspaceTone,
} from "../lib/internal-control-plane";

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

export const Route = createFileRoute("/organization")({
  component: OrganizationRoute,
});

function OrganizationRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canInspectRoster = activeRole === "owner" || activeRole === "admin";

  const [memberStatus, setMemberStatus] = useState<LoadStatus>("idle");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);

  const [workspaceStatus, setWorkspaceStatus] = useState<LoadStatus>("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [memberWorkStatus, setMemberWorkStatus] = useState<LoadStatus>("idle");
  const [memberWorkError, setMemberWorkError] = useState<string | null>(null);
  const [memberRunScope, setMemberRunScope] = useState<MemberRunScope | null>(null);
  const dataEnabled = Boolean(session && activeOrganization?.id);
  const projectCollection = useCustomerProjectsCollection(dataEnabled);
  const workspaceCollection = useCustomerWorkspacesCollection(dataEnabled);
  const memberRunCollection = useCustomerMemberRunsCollection(dataEnabled);
  const projects = dataEnabled ? projectCollection.projects : [];
  const workspaces = dataEnabled ? workspaceCollection.workspaces : [];
  const memberRuns = dataEnabled ? memberRunCollection.runs : [];

  useEffect(() => {
    if (!session) {
      setMemberStatus("idle");
      setMemberError(null);
      setMembers([]);
      setInvitations([]);
      setWorkspaceStatus("idle");
      setWorkspaceError(null);
      setMemberWorkStatus("idle");
      setMemberWorkError(null);
      setMemberRunScope(null);
      void Promise.all([
        clearCustomerProjectsSnapshot(),
        clearCustomerWorkspacesSnapshot(),
        clearCustomerMemberRunsSnapshot(),
      ]).catch(() => undefined);
      return;
    }

    if (!activeOrganization?.id) {
      setMemberStatus("ready");
      setMemberError(null);
      setWorkspaceStatus("ready");
      setWorkspaceError(null);
      setMembers([]);
      setInvitations([]);
      setMemberWorkStatus("ready");
      setMemberWorkError(null);
      setMemberRunScope(null);
      void Promise.all([
        clearCustomerProjectsSnapshot(),
        clearCustomerWorkspacesSnapshot(),
        clearCustomerMemberRunsSnapshot(),
      ]).catch(() => undefined);
      return;
    }

    void refreshEverything(activeOrganization.id);
  }, [activeOrganization?.id, canInspectRoster, session?.session.id]);

  const assignedProjectIds = useMemo(
    () => new Set(memberRuns.map((run) => run.tenantId)),
    [memberRuns],
  );
  const assignedProjects = useMemo(
    () => projects.filter((project) => assignedProjectIds.has(project.id)),
    [assignedProjectIds, projects],
  );
  const assignedWorkspaces = useMemo(
    () => workspaces.filter((workspace) => assignedProjectIds.has(workspace.tenantId)),
    [assignedProjectIds, workspaces],
  );
  const assignedReadyWorkspaces = useMemo(
    () => assignedWorkspaces.filter((workspace) => workspaceIsReady(workspace)),
    [assignedWorkspaces],
  );
  const memberPullRequestCount = useMemo(
    () => memberRuns.filter((run) => Boolean(getRunPullRequestUrl(run))).length,
    [memberRuns],
  );
  const latestAssignedRun = memberRuns[0] ?? null;
  const hiddenOrganizationProjectCount = Math.max(projects.length - assignedProjects.length, 0);
  const hiddenOrganizationWorkspaceCount = Math.max(
    workspaces.length - assignedWorkspaces.length,
    0,
  );

  async function refreshEverything(organizationId: string) {
    if (!canInspectRoster) {
      setMemberStatus("ready");
      setMemberError(null);
      setMembers([]);
      setInvitations([]);
    }

    await Promise.all([
      refreshProjects(),
      refreshMemberWork(),
      ...(canInspectRoster ? [refreshMembers(organizationId)] : []),
    ]);
  }

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
      setMemberError(toErrorMessage(caughtError, "Unable to load organization roster."));
      setMembers([]);
      setInvitations([]);
    }
  }

  async function refreshProjects() {
    setWorkspaceStatus("loading");
    setWorkspaceError(null);

    try {
      const nextProjects = await refreshCustomerProjectsSnapshot();

      if (nextProjects.length === 0) {
        await clearCustomerWorkspacesSnapshot();
        setWorkspaceStatus("ready");
        return;
      }

      await refreshCustomerWorkspacesSnapshot(nextProjects);
      setWorkspaceStatus("ready");
    } catch (caughtError) {
      setWorkspaceStatus("error");
      setWorkspaceError(toErrorMessage(caughtError, "Unable to load organization projects."));
      await Promise.all([clearCustomerProjectsSnapshot(), clearCustomerWorkspacesSnapshot()]).catch(
        () => undefined,
      );
    }
  }

  async function refreshMemberWork() {
    if (!session) {
      return;
    }

    setMemberWorkStatus("loading");
    setMemberWorkError(null);

    try {
      const result = await refreshCustomerMemberRunsSnapshot({
        email: session.user.email,
        userId: session.user.id,
      });

      setMemberRunScope(result.scope);
      setMemberWorkStatus("ready");
    } catch (caughtError) {
      setMemberWorkStatus("error");
      setMemberWorkError(toErrorMessage(caughtError, "Unable to load assigned work."));
      setMemberRunScope(null);
      await clearCustomerMemberRunsSnapshot().catch(() => undefined);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Organization"
      description="A member-assigned-work view first: your projects, runs, and devbox access lead this route, while owner/admin sessions still keep a wider organization read surface below."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh organization"
            onClick={() =>
              activeOrganization?.id ? void refreshEverything(activeOrganization.id) : undefined
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
      <CustomerRouteNavigation currentPath="/organization" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Current Better Auth organization attached to the session."
          label="Active organization"
          tone={activeOrganization ? "success" : "warning"}
          value={activeOrganization?.name ?? "none"}
        />
        <StatCard
          detail="Current membership role in that organization."
          label="Your role"
          tone={memberStatus === "error" ? "danger" : activeRole ? "success" : "neutral"}
          value={activeRole ? toRoleLabel(activeRole) : "unknown"}
        />
        <StatCard
          detail="Projects currently tied to your member-scoped runs."
          label="Assigned projects"
          tone={assignedProjects.length > 0 ? "success" : statusTone(memberWorkStatus)}
          value={String(assignedProjects.length)}
        />
        <StatCard
          detail="Pull request links exposed by your member-scoped run history."
          label="My pull requests"
          tone={memberPullRequestCount > 0 ? "success" : statusTone(memberWorkStatus)}
          value={String(memberPullRequestCount)}
        />
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-2">
        <StatCard
          detail="Run rows returned through the explicit member filter."
          label="Assigned runs"
          tone={memberRuns.length > 0 ? "success" : statusTone(memberWorkStatus)}
          value={String(memberRuns.length)}
        />
        <StatCard
          detail="Ready devboxes attached to projects in your member-scoped lane."
          label="Ready devboxes"
          tone={assignedReadyWorkspaces.length > 0 ? "success" : statusTone(workspaceStatus)}
          value={String(assignedReadyWorkspaces.length)}
        />
      </SectionGrid>

      {memberError || workspaceError || memberWorkError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Organization surface unavailable
              </CardTitle>
              <CardDescription>{memberWorkError ?? memberError ?? workspaceError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-5" />
              Assigned work
            </CardTitle>
            <CardDescription>
              {memberRunScope?.description ??
                "This route now starts from your member-scoped runs before widening out to broader organization context."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {memberRunScope?.requestedBy ? (
              <StatusPill tone="success">{`requestedBy=${memberRunScope.requestedBy}`}</StatusPill>
            ) : null}
            {!session ? (
              <p className="text-sm text-muted-foreground">
                Sign in and activate an organization to load your assigned projects, runs, and PRs.
              </p>
            ) : !activeOrganization ? (
              <p className="text-sm text-muted-foreground">
                Pick an active organization first so this route can narrow to your assigned work.
              </p>
            ) : latestAssignedRun ? (
              <div className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{latestAssignedRun.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {latestAssignedRun.projectName ?? "Unknown project"} • updated{" "}
                      {formatDate(latestAssignedRun.updatedAt ?? latestAssignedRun.createdAt)}
                    </p>
                  </div>
                  <StatusPill tone={runTone(latestAssignedRun.status)}>
                    {latestAssignedRun.status}
                  </StatusPill>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {latestAssignedRun.failureMessage ??
                    latestAssignedRun.resultSummary ??
                    "Open the member-scoped runs route to inspect the latest outcome."}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No assigned runs are visible yet. This organization route will fill in as soon as a
                dispatch lands in your member-scoped run history.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" type="button">
                <Link to="/runs">Open my runs</Link>
              </Button>
              <Button asChild size="sm" type="button" variant="outline">
                <Link to="/pull-requests">
                  <GitPullRequest className="size-4" />
                  Open my pull requests
                </Link>
              </Button>
            </div>
            {canInspectRoster ? (
              <p className="text-xs text-muted-foreground">
                Your role still keeps broader roster, project, and devbox visibility below.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              Projects in your lane
            </CardTitle>
            <CardDescription>
              Projects currently tied to your member-scoped runs, even if the organization exposes
              more projects overall.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {assignedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects are currently tied to your assigned run history.
              </p>
            ) : (
              assignedProjects.map((project) => (
                <div className="rounded-xl border p-3" key={project.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {project.repoOwner && project.repoName
                          ? `${project.repoOwner}/${project.repoName}`
                          : "Repo not exposed"}{" "}
                        • {project.slug}
                      </p>
                    </div>
                    <StatusPill tone={projectTone(project.status)}>{project.status}</StatusPill>
                  </div>
                  {project.description ? (
                    <p className="mt-3 text-sm text-muted-foreground">{project.description}</p>
                  ) : null}
                </div>
              ))
            )}
            {canInspectRoster && hiddenOrganizationProjectCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {hiddenOrganizationProjectCount} additional organization project
                {hiddenOrganizationProjectCount === 1 ? "" : "s"} remain visible in the wider
                owner/admin view below.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Devbox access</CardTitle>
            <CardDescription>
              Ready or in-progress devboxes attached to your assigned work.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {assignedWorkspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No devboxes are attached to your member-scoped work yet.
              </p>
            ) : (
              assignedWorkspaces.map((workspace) => (
                <div className="rounded-xl border p-3" key={workspace.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{workspace.projectName}</p>
                      <p className="text-sm text-muted-foreground">
                        {workspace.name ?? workspace.workspaceId} • {workspace.provider}
                      </p>
                    </div>
                    <StatusPill tone={workspaceTone(workspace)}>{workspace.status}</StatusPill>
                  </div>
                  <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                    Updated {formatDate(workspace.updatedAt)}
                  </p>
                  {workspace.ideUrl ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={workspace.ideUrl} rel="noreferrer" target="_blank">
                          <ExternalLink className="size-4" />
                          Open IDE
                        </a>
                      </Button>
                      {workspace.previewUrl ? (
                        <Button asChild size="sm" type="button" variant="outline">
                          <a href={workspace.previewUrl} rel="noreferrer" target="_blank">
                            <ExternalLink className="size-4" />
                            Preview
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : workspace.previewUrl ? (
                    <div className="mt-3">
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={workspace.previewUrl} rel="noreferrer" target="_blank">
                          <ExternalLink className="size-4" />
                          Preview
                        </a>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {canInspectRoster && hiddenOrganizationWorkspaceCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {hiddenOrganizationWorkspaceCount} additional organization devbox
                {hiddenOrganizationWorkspaceCount === 1 ? "" : "es"} remain visible in the wider
                owner/admin view below.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </SectionGrid>

      {canInspectRoster ? (
        <SectionGrid className="xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5" />
                Team and invitations
              </CardTitle>
              <CardDescription>
                Wider organization roster visibility preserved for owner/admin memberships.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {members.length === 0 && invitations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No roster data is visible for the active organization.
                </p>
              ) : (
                <>
                  {members.map((member) => (
                    <div className="rounded-xl border p-3" key={member.id}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{member.user.name}</p>
                          <p className="text-sm text-muted-foreground">{member.user.email}</p>
                        </div>
                        <StatusPill tone={member.role === "member" ? "neutral" : "success"}>
                          {toRoleLabel(member.role)}
                        </StatusPill>
                      </div>
                    </div>
                  ))}
                  {invitations.map((invitation) => (
                    <div className="rounded-xl border border-dashed p-3" key={invitation.id}>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-sm text-muted-foreground">
                        Invite pending until {new Date(invitation.expiresAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-5" />
                Organization project inventory
              </CardTitle>
              <CardDescription>
                Full organization project visibility retained for owner/admin sessions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No projects are visible for this organization yet.
                </p>
              ) : (
                projects.map((project) => (
                  <div className="rounded-xl border p-3" key={project.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {project.repoOwner && project.repoName
                            ? `${project.repoOwner}/${project.repoName}`
                            : "Repo not exposed"}{" "}
                          • {project.slug}
                        </p>
                      </div>
                      <StatusPill tone={projectTone(project.status)}>{project.status}</StatusPill>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization devbox visibility</CardTitle>
              <CardDescription>
                Full organization devbox access preserved for owner/admin memberships.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {workspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No devboxes are visible for this organization yet.
                </p>
              ) : (
                workspaces.map((workspace) => (
                  <div className="rounded-xl border p-3" key={workspace.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{workspace.projectName}</p>
                        <p className="text-sm text-muted-foreground">
                          {workspace.name ?? workspace.workspaceId} • {workspace.provider}
                        </p>
                      </div>
                      <StatusPill tone={workspaceTone(workspace)}>{workspace.status}</StatusPill>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                      Updated {formatDate(workspace.updatedAt)}
                    </p>
                    {workspace.ideUrl ? (
                      <div className="mt-3">
                        <Button asChild size="sm" type="button" variant="outline">
                          <a href={workspace.ideUrl} rel="noreferrer" target="_blank">
                            <ExternalLink className="size-4" />
                            Open IDE
                          </a>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </SectionGrid>
      ) : null}
    </AppPage>
  );
}

function statusTone(status: LoadStatus) {
  switch (status) {
    case "ready":
      return "success";
    case "error":
      return "danger";
    case "loading":
      return "warning";
    default:
      return "neutral";
  }
}
