import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  ClipboardList,
  FolderKanban,
  GitPullRequest,
  LogOut,
  Megaphone,
  RefreshCw,
  Rocket,
  ServerCog,
  ShieldCheck,
  Users,
  Workflow,
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
import { CustomerRouteNavigation } from "../lib/customer-route-navigation";
import { buildCustomerPath, toErrorMessage, toRoleLabel } from "../lib/customer-auth";
import {
  type ActivityItem,
  type LoadStatus,
  type Overview,
  type Project,
  type RunRecord,
  type Workspace,
  formatDate,
  getRunPullRequestUrl,
  normalizeActivity,
  normalizeOverview,
  normalizeProjects,
  normalizeWorkspaces,
  projectTone,
  requestInternalApi,
  runTone,
  statusTone,
  workspaceIsReady,
  workspaceTone,
} from "../lib/internal-control-plane";
import { loadMemberScopedRuns, type MemberRunScope } from "../lib/member-scoped-runs";

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

type WorkspaceAccessItem = Workspace & {
  projectName: string;
  projectSlug: string;
};

type ActiveOrganizationSummary = {
  id: string;
  name: string;
  slug: string;
};

type CustomerLandingSearch = {
  adminReturn?: string;
};

const defaultState: PublicApiState = {
  announcements: [],
  products: [],
};

const emptyOverview: Overview = {
  activeRuns: 0,
  failedRuns: 0,
  pendingInvitations: 0,
  projectCount: 0,
  readyWorkspaces: 0,
  runCount: 0,
  workspaceCount: 0,
};

function resolveAdminOrigin() {
  const configuredAdminOrigin = process.env.ADMIN_WEB_URL;

  if (typeof configuredAdminOrigin === "string" && configuredAdminOrigin.length > 0) {
    return configuredAdminOrigin;
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  return "http://127.0.0.1:3001";
}

function normalizeAdminReturnPath(pathOrUrl?: string) {
  if (!pathOrUrl) {
    return null;
  }

  const adminOrigin = new URL(resolveAdminOrigin());

  try {
    const target = new URL(pathOrUrl, adminOrigin);

    if (target.origin !== adminOrigin.origin) {
      return null;
    }

    return `${target.pathname}${target.search}${target.hash}` || null;
  } catch {
    return null;
  }
}

function buildCustomerHomeRedirectPath(adminReturnPath: string | null) {
  if (!adminReturnPath) {
    return "/";
  }

  const searchParams = new URLSearchParams();

  searchParams.set("adminReturn", adminReturnPath);

  return `/?${searchParams.toString()}`;
}

function buildAdminReturnHref(adminReturnPath: string | null) {
  if (!adminReturnPath) {
    return null;
  }

  const adminOrigin = new URL(resolveAdminOrigin());
  const target = new URL(adminReturnPath, adminOrigin);

  return target.toString();
}

function buildAdminRouteHref(path: string) {
  return new URL(path, resolveAdminOrigin()).toString();
}

function isActiveRunStatus(status: string) {
  return [
    "pending",
    "queued",
    "running",
    "in_progress",
    "provisioning",
    "workspace_ready",
  ].includes(status.toLowerCase());
}

function isAttentionRunStatus(status: string) {
  return ["failed", "error", "cancelled"].includes(status.toLowerCase());
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): CustomerLandingSearch => {
    const nextSearch: CustomerLandingSearch = {};

    if (typeof search.adminReturn === "string" && search.adminReturn.length > 0) {
      nextSearch.adminReturn = search.adminReturn;
    }

    return nextSearch;
  },
  component: CustomerLanding,
});

function toResolvedOrganizationSummary(
  organization:
    | {
        id?: string | null;
        name?: string | null;
        slug?: string | null;
      }
    | null
    | undefined,
): ActiveOrganizationSummary | null {
  if (!organization?.id) {
    return null;
  }

  return {
    id: organization.id,
    name: organization.name ?? organization.slug ?? organization.id,
    slug: organization.slug ?? organization.id,
  };
}

function CustomerLanding() {
  const search = Route.useSearch();
  const sessionQuery = authClient.useSession();
  const organizationsQuery = authClient.useListOrganizations();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data;
  const organizations = organizationsQuery.data ?? [];
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const [resolvedSession, setResolvedSession] = useState<typeof session>(session);
  const [resolvedActiveOrganization, setResolvedActiveOrganization] =
    useState<ActiveOrganizationSummary | null>(toResolvedOrganizationSummary(activeOrganization));

  const [state, setState] = useState<PublicApiState>(defaultState);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [invitationStatus, setInvitationStatus] = useState<LoadStatus>("idle");
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<LoadStatus>("idle");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [opsStatus, setOpsStatus] = useState<LoadStatus>("idle");
  const [opsError, setOpsError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [memberRunScope, setMemberRunScope] = useState<MemberRunScope | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<LoadStatus>("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceAccessItem[]>([]);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  type ResolvedAuthState = {
    activeOrganization: ActiveOrganizationSummary | null;
    organizations: typeof organizations;
    session: typeof session;
  };

  const organizationClientApi = authClient.organization as unknown as {
    activeOrganization: () => Promise<{
      data?: typeof activeOrganization;
      error?: unknown;
    }>;
    list: () => Promise<{
      data?: typeof organizations;
      error?: unknown;
    }>;
  };
  const currentSession = resolvedSession ?? session ?? null;
  const adminReturnPath = normalizeAdminReturnPath(search.adminReturn);
  const adminReturnHref = buildAdminReturnHref(adminReturnPath);
  const adminProjectSetupHref = buildAdminRouteHref("/projects");
  const adminBlueprintHref = buildAdminRouteHref("/blueprints");
  const adminRunComposerHref = buildAdminRouteHref("/runs");
  const signInRedirectPath = buildCustomerPath(buildCustomerHomeRedirectPath(adminReturnPath), "/");

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

  function resetPersonalSurface(nextStatus: LoadStatus) {
    setProjectStatus(nextStatus);
    setProjectError(null);
    setProjects([]);
    setOpsStatus(nextStatus);
    setOpsError(null);
    setOverview(emptyOverview);
    setRuns([]);
    setMemberRunScope(null);
    setActivity([]);
    setWorkspaceStatus(nextStatus);
    setWorkspaceError(null);
    setWorkspaces([]);
  }

  async function refreshProjects() {
    setProjectStatus("loading");
    setProjectError(null);

    try {
      const payload = (await requestInternalApi("/projects")) as {
        projects?: unknown[];
      } | null;
      const nextProjects = normalizeProjects(payload?.projects);

      setProjects(nextProjects);
      setProjectStatus("ready");

      return nextProjects;
    } catch (caughtError) {
      setProjectStatus("error");
      setProjectError(
        toErrorMessage(caughtError, "Unable to load projects for this organization."),
      );
      setProjects([]);

      return [] satisfies Project[];
    }
  }

  async function refreshWorkspaces(projectList: Project[]) {
    if (projectList.length === 0) {
      setWorkspaceStatus("ready");
      setWorkspaceError(null);
      setWorkspaces([]);
      return;
    }

    setWorkspaceStatus("loading");
    setWorkspaceError(null);

    try {
      const payloads = await Promise.all(
        projectList.map(async (project) => {
          const payload = (await requestInternalApi(
            `/workspaces?tenantId=${encodeURIComponent(project.id)}`,
          )) as {
            workspaces?: unknown[];
          } | null;

          return normalizeWorkspaces(payload?.workspaces).map((workspace) => ({
            ...workspace,
            projectName: project.name,
            projectSlug: project.slug,
          }));
        }),
      );

      const nextWorkspaces = payloads
        .flat()
        .sort(
          (left, right) =>
            toTimestamp(right.updatedAt ?? right.createdAt) -
            toTimestamp(left.updatedAt ?? left.createdAt),
        );

      setWorkspaces(nextWorkspaces);
      setWorkspaceStatus("ready");
    } catch (caughtError) {
      setWorkspaceStatus("error");
      setWorkspaceError(
        toErrorMessage(caughtError, "Unable to load workspace access for this organization."),
      );
      setWorkspaces([]);
    }
  }

  async function refreshOperations(activeSession: typeof currentSession = currentSession) {
    if (!activeSession) {
      setOpsStatus("idle");
      setOpsError(null);
      setOverview(emptyOverview);
      setRuns([]);
      setMemberRunScope(null);
      setActivity([]);
      return;
    }

    setOpsStatus("loading");
    setOpsError(null);

    try {
      const [overviewPayload, memberScopedRuns, activityPayload] = await Promise.all([
        requestInternalApi("/overview"),
        loadMemberScopedRuns({
          email: activeSession.user.email,
          userId: activeSession.user.id,
        }),
        requestInternalApi("/activity"),
      ]);

      setOverview(normalizeOverview((overviewPayload as { overview?: unknown } | null)?.overview));
      setRuns(memberScopedRuns.runs);
      setMemberRunScope(memberScopedRuns.scope);
      setActivity(
        normalizeActivity((activityPayload as { activity?: unknown[] } | null)?.activity),
      );
      setOpsStatus("ready");
    } catch (caughtError) {
      setOpsStatus("error");
      setOpsError(
        toErrorMessage(caughtError, "Unable to load your projects, runs, and activity surface."),
      );
      setOverview(emptyOverview);
      setRuns([]);
      setMemberRunScope(null);
      setActivity([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setResolvedSession(session ?? null);
  }, [session]);

  useEffect(() => {
    if (!currentSession) {
      setResolvedActiveOrganization(null);
      return;
    }

    if (activeOrganization?.id) {
      setResolvedActiveOrganization(toResolvedOrganizationSummary(activeOrganization));
    }
  }, [activeOrganization, currentSession?.session.id]);

  useEffect(() => {
    if (!currentSession) {
      setInvitations([]);
      setInvitationStatus("idle");
      setInvitationError(null);
      return;
    }

    void refreshInvitations();
  }, [currentSession?.session.id]);

  useEffect(() => {
    if (
      !currentSession ||
      activeOrganization?.id ||
      organizations.length !== 1 ||
      !organizations[0]?.id
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await authClient.organization.setActive({
        organizationId: organizations[0].id,
      });

      if (result.error) {
        throw result.error;
      }

      if (!cancelled) {
        const authState = await refreshAuthState();

        setResolvedActiveOrganization(
          toResolvedOrganizationSummary(authState.activeOrganization ?? organizations[0] ?? null),
        );
      }
    })().catch((caughtError) => {
      if (!cancelled) {
        setNotice({
          message: toErrorMessage(caughtError, "Unable to restore the active organization."),
          tone: "danger",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeOrganization?.id,
    currentSession?.session.id,
    organizations.length,
    organizations[0]?.id,
  ]);

  useEffect(() => {
    if (!currentSession) {
      resetPersonalSurface("idle");
      return;
    }

    if (!resolvedActiveOrganization?.id) {
      resetPersonalSurface("ready");
      return;
    }

    void refreshOperations();
    void (async () => {
      const nextProjects = await refreshProjects();
      await refreshWorkspaces(nextProjects);
    })();
  }, [currentSession?.session.id, resolvedActiveOrganization?.id]);

  async function refreshAuthState(): Promise<ResolvedAuthState> {
    const [nextSessionResult, nextOrganizationsResult, nextActiveOrganizationResult, , , ,] =
      await Promise.all([
        authClient.getSession(),
        organizationClientApi.list(),
        organizationClientApi.activeOrganization(),
        sessionQuery.refetch(),
        organizationsQuery.refetch(),
        activeOrganizationQuery.refetch(),
      ]);

    const nextSession = nextSessionResult.data ?? null;
    const nextOrganizations = nextOrganizationsResult.data ?? [];
    const nextActiveOrganization = toResolvedOrganizationSummary(
      nextActiveOrganizationResult.data ?? null,
    );

    setResolvedSession(nextSession);
    setResolvedActiveOrganization(nextActiveOrganization);

    return {
      activeOrganization: nextActiveOrganization,
      organizations: nextOrganizations,
      session: nextSession,
    };
  }

  async function refreshInvitations(activeSession: typeof currentSession = currentSession) {
    if (!activeSession) {
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

  async function ensureActiveOrganization(
    authState: Awaited<ReturnType<typeof refreshAuthState>>,
  ): Promise<Awaited<ReturnType<typeof refreshAuthState>>> {
    if (!authState.session) {
      return authState;
    }

    if (authState.activeOrganization?.id) {
      setResolvedActiveOrganization(toResolvedOrganizationSummary(authState.activeOrganization));
      return authState;
    }

    const singleOrganization =
      authState.organizations.length === 1 ? authState.organizations[0] : null;

    if (!singleOrganization?.id) {
      setResolvedActiveOrganization(null);
      return authState;
    }

    const result = await authClient.organization.setActive({
      organizationId: singleOrganization.id,
    });

    if (result.error) {
      throw result.error;
    }

    const nextAuthState = await refreshAuthState();

    setResolvedActiveOrganization(
      toResolvedOrganizationSummary(nextAuthState.activeOrganization ?? singleOrganization),
    );

    return {
      ...nextAuthState,
      activeOrganization:
        nextAuthState.activeOrganization ?? toResolvedOrganizationSummary(singleOrganization),
    };
  }

  async function refreshEverything() {
    const [, refreshedAuthState] = await Promise.all([refresh(), refreshAuthState()]);
    const nextAuthState = await ensureActiveOrganization(refreshedAuthState);

    if (nextAuthState.session) {
      try {
        await refreshInvitations(nextAuthState.session);
      } catch (caughtError) {
        setNotice({
          message: toErrorMessage(
            caughtError,
            "Workspace data refreshed, but the invitation list could not be updated.",
          ),
          tone: "danger",
        });
      }
    }

    if (nextAuthState.session && nextAuthState.activeOrganization?.id) {
      const [nextProjects] = await Promise.all([
        refreshProjects(),
        refreshOperations(nextAuthState.session),
      ]);
      await refreshWorkspaces(nextProjects);
    } else {
      resetPersonalSurface(nextAuthState.session ? "ready" : "idle");
    }
  }

  async function handleRefreshEverything() {
    setNotice(null);

    try {
      await refreshEverything();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to refresh the customer workspace."),
        tone: "danger",
      });
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
      resetPersonalSurface("idle");
      await refreshAuthState();
      setResolvedSession(null);
      setResolvedActiveOrganization(null);
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

      const authState = await refreshAuthState();
      const selectedOrganization =
        authState.organizations.find((organization) => organization.id === organizationId) ?? null;

      setResolvedActiveOrganization(
        toResolvedOrganizationSummary(authState.activeOrganization ?? selectedOrganization),
      );
    });
  }

  const featuredCount = state.products.filter((product) => product.featured).length;
  const pendingInvitationCount = invitations.filter(
    (invitation) => invitation.status === "pending",
  ).length;
  const recentProjects = projects.slice(0, 4);
  const recentRuns = runs.slice(0, 4);
  const recentPullRequests = runs.filter((run) => Boolean(getRunPullRequestUrl(run))).slice(0, 3);
  const recentActivity = activity.slice(0, 5);
  const visibleWorkspaces = workspaces.slice(0, 5);
  const readyWorkspaceCount = workspaces.filter((workspace) => workspaceIsReady(workspace)).length;
  const hasWorkspaceSurface = Boolean(currentSession && resolvedActiveOrganization?.id);
  const activeMemberRunCount = runs.filter((run) => isActiveRunStatus(run.status)).length;
  const attentionRunCount = runs.filter((run) => isAttentionRunStatus(run.status)).length;
  const latestRun = recentRuns[0] ?? null;
  const latestAttentionRun = runs.find((run) => isAttentionRunStatus(run.status)) ?? null;
  const latestReadyWorkspace = workspaces.find((workspace) => workspaceIsReady(workspace)) ?? null;
  const resumeSummary = getResumeSummary({
    latestAttentionRun,
    latestReadyWorkspace,
    latestRun,
    recentPullRequestCount: recentPullRequests.length,
  });
  const serviceUpdateCount = state.announcements.length + featuredCount;

  return (
    <AppPage
      eyebrow="Customer web"
      title="My work"
      description="A member dashboard first: keep the current customer auth and invitation flows intact, but make runs, pull requests, and next action the primary home surface."
      actions={
        <>
          {currentSession && adminReturnHref ? (
            <Button asChild type="button">
              <a href={adminReturnHref}>Return to admin</a>
            </Button>
          ) : null}
          <Button
            aria-label="Refresh customer workspace"
            onClick={() => void handleRefreshEverything()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          {currentSession ? (
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
                    redirect: signInRedirectPath,
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

      <CustomerRouteNavigation currentPath="/" />

      {adminReturnHref ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5" />
                  Continue to admin
                </CardTitle>
                <CardDescription>
                  This customer route is now the real sign-in handoff for protected admin deep
                  links. Your requested admin path stays attached until you continue.
                </CardDescription>
              </div>
              <StatusPill tone={currentSession ? "success" : "warning"}>
                {currentSession ? "ready to continue" : "sign in first"}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Requested admin route: <code>{adminReturnPath}</code>
            </p>
            <div className="flex flex-wrap gap-3">
              {currentSession ? (
                <Button asChild type="button">
                  <a href={adminReturnHref}>Return to admin</a>
                </Button>
              ) : (
                <Button asChild type="button">
                  <Link
                    search={{
                      email: "",
                      redirect: signInRedirectPath,
                    }}
                    to="/sign-in"
                  >
                    Sign in to continue
                  </Link>
                </Button>
              )}
              <Button asChild type="button" variant="outline">
                <Link to="/runs">Open my runs</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          label="Active organization"
          value={resolvedActiveOrganization?.name ?? "none"}
          detail={
            resolvedActiveOrganization
              ? `Slug ${resolvedActiveOrganization.slug}.`
              : "Accept an invitation or finish owner bootstrap."
          }
          tone={resolvedActiveOrganization ? "success" : "warning"}
        />
        <StatCard
          label="My runs"
          value={hasWorkspaceSurface ? String(runs.length) : "locked"}
          detail={
            hasWorkspaceSurface
              ? (memberRunScope?.description ?? "Member-scoped runs for the current session.")
              : "Sign in and activate an organization to load your work."
          }
          tone={opsStatus === "error" ? "danger" : hasWorkspaceSurface ? "success" : "neutral"}
        />
        <StatCard
          label="Pull requests"
          value={hasWorkspaceSurface ? String(recentPullRequests.length) : "locked"}
          detail={
            hasWorkspaceSurface
              ? "Recent run records with pull request evidence attached."
              : "Visible after member-scoped runs load."
          }
          tone={recentPullRequests.length > 0 ? "success" : "neutral"}
        />
        <StatCard
          label="Active work"
          value={hasWorkspaceSurface ? String(activeMemberRunCount) : "locked"}
          detail={
            hasWorkspaceSurface
              ? "Runs still queued, provisioning, or actively executing for you."
              : "Choose an active organization to unlock project access."
          }
          tone={activeMemberRunCount > 0 ? "warning" : opsStatus === "error" ? "danger" : "neutral"}
        />
        <StatCard
          label="Needs attention"
          value={hasWorkspaceSurface ? String(attentionRunCount) : "locked"}
          detail={
            hasWorkspaceSurface
              ? "Failed or cancelled runs in your current member-scoped slice."
              : "Signed-in members only."
          }
          tone={attentionRunCount > 0 ? "danger" : "neutral"}
        />
        <StatCard
          label="Latest run"
          value={latestRun?.status ?? (hasWorkspaceSurface ? "none" : "locked")}
          detail={
            hasWorkspaceSurface
              ? latestRun
                ? `${latestRun.title} · ${formatDate(latestRun.updatedAt ?? latestRun.createdAt)}`
                : "No member-scoped run visible yet."
              : "Unlocks after sign-in and organization activation."
          }
          tone={latestRun ? runTone(latestRun.status) : "neutral"}
        />
        <StatCard
          label="Devboxes ready"
          value={hasWorkspaceSurface ? String(readyWorkspaceCount) : "locked"}
          detail={
            hasWorkspaceSurface
              ? `${overview.workspaceCount} workspace records across accessible projects.`
              : "Workspace access appears after org activation."
          }
          tone={
            workspaceStatus === "error" ? "danger" : readyWorkspaceCount > 0 ? "success" : "neutral"
          }
        />
        <StatCard
          label="Projects"
          value={hasWorkspaceSurface ? String(overview.projectCount) : "locked"}
          detail={
            hasWorkspaceSurface
              ? "Projects returned by the internal control-plane read surface."
              : "Choose an active organization to unlock project access."
          }
          tone={projectStatus === "error" ? "danger" : hasWorkspaceSurface ? "success" : "neutral"}
        />
        <StatCard
          label="Pending invitations"
          value={String(pendingInvitationCount)}
          detail="Invitation records addressable through customer-web."
          tone={invitations.length > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Service updates"
          value={String(serviceUpdateCount)}
          detail="Announcements plus featured catalog items, kept secondary to your work."
          tone={status === "error" ? "danger" : serviceUpdateCount > 0 ? "success" : "neutral"}
        />
      </SectionGrid>

      <SectionGrid>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5" />
                  Account and organization access
                </CardTitle>
                <CardDescription>
                  Sign-in, invite, and organization controls stay here, but the dashboard keeps them
                  secondary to the member work surface above.
                </CardDescription>
              </div>
              <StatusPill tone={currentSession ? "success" : "neutral"}>
                {currentSession ? "authenticated" : "guest"}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentSession ? (
              <>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="font-medium">{currentSession.user.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{currentSession.user.email}</p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Email verified: {currentSession.user.emailVerified ? "yes" : "no"}
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
                        const isResolvedActive =
                          resolvedActiveOrganization?.id === organization.id || isActive;

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
                                disabled={isResolvedActive || busyAction === "set-active"}
                                onClick={() => void handleSetActiveOrganization(organization.id)}
                                type="button"
                                variant={isResolvedActive ? "secondary" : "outline"}
                              >
                                {isResolvedActive ? "Active" : "Set active"}
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
                  Customer-web still owns owner sign-up, invite acceptance, verification follow-up,
                  and password reset, but those are now access steps into the member dashboard
                  rather than the main event on this page.
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
                        redirect: signInRedirectPath,
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
                  <Rocket className="size-5" />
                  Next best action
                </CardTitle>
                <CardDescription>
                  The fastest useful jump-off based on your current session, organization, and
                  visible work state.
                </CardDescription>
              </div>
              <StatusPill
                tone={
                  latestAttentionRun
                    ? "danger"
                    : latestReadyWorkspace || recentPullRequests.length > 0
                      ? "success"
                      : hasWorkspaceSurface
                        ? "warning"
                        : "neutral"
                }
              >
                {hasWorkspaceSurface ? "guided" : "setup"}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentSession ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Start with owner sign-up or sign in with the email that received the invitation.
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
                        redirect: signInRedirectPath,
                      }}
                      to="/sign-in"
                    >
                      Sign in
                    </Link>
                  </Button>
                </div>
              </>
            ) : !resolvedActiveOrganization ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Pick an active organization first so this workspace can load your runs, pull
                  requests, and devbox access.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button">
                    <Link to="/account">Open account</Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/invitations">Open invitations</Link>
                  </Button>
                </div>
              </>
            ) : projectError || opsError || workspaceError ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Refresh the workspace surface or open the organization page to check what failed
                  to load.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => void handleRefreshEverything()} type="button">
                    <RefreshCw className="size-4" />
                    Refresh workspace
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/organization">Open organization</Link>
                  </Button>
                </div>
              </>
            ) : projects.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Your membership is active, but no project is registered yet. Register the first
                  GitHub project in admin, pick a Blueprint, and then dispatch the first run back
                  into this customer workspace.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button">
                    <a href={adminProjectSetupHref}>Open project setup</a>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <a href={adminBlueprintHref}>Open blueprints</a>
                  </Button>
                  {adminReturnHref ? (
                    <Button asChild type="button" variant="outline">
                      <a href={adminReturnHref}>Return to admin</a>
                    </Button>
                  ) : null}
                </div>
              </>
            ) : latestAttentionRun ? (
              <>
                <p className="text-sm text-muted-foreground">
                  A recent run needs attention before it turns into a clean PR handoff.
                </p>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="font-medium">{latestAttentionRun.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {latestAttentionRun.failureMessage ??
                      latestAttentionRun.resultSummary ??
                      "Open the run detail to review the current outcome."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button">
                    <Link params={{ runId: latestAttentionRun.id }} to="/runs/$runId">
                      Open failing run
                    </Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/runs">Open my runs</Link>
                  </Button>
                </div>
              </>
            ) : recentPullRequests.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Reviewable output already exists. Jump straight to your PR visibility surface.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button">
                    <Link to="/pull-requests">Open pull requests</Link>
                  </Button>
                  {latestRun ? (
                    <Button asChild type="button" variant="outline">
                      <Link params={{ runId: latestRun.id }} to="/runs/$runId">
                        Open latest run
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </>
            ) : latestReadyWorkspace ? (
              <>
                <p className="text-sm text-muted-foreground">
                  A ready devbox is visible for one of your projects. Resume from the organization
                  surface and open the workspace there.
                </p>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="font-medium">{latestReadyWorkspace.projectName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {latestReadyWorkspace.repoOwner}/{latestReadyWorkspace.repoName} ·{" "}
                    {latestReadyWorkspace.status}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button">
                    <Link to="/organization">Open organization</Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/runs">Open my runs</Link>
                  </Button>
                </div>
              </>
            ) : latestRun ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Your latest run is the best place to resume context.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button">
                    <Link params={{ runId: latestRun.id }} to="/runs/$runId">
                      Open latest run
                    </Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/runs">Open my runs</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  The organization is set up, but no member-scoped run is visible yet. Dispatch the
                  first run in admin or use the organization route while the first queue item lands.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button">
                    <a href={adminRunComposerHref}>Dispatch first run</a>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/organization">Open organization</Link>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Workflow className="size-5" />
                  My work hub
                </CardTitle>
                <CardDescription>
                  A member-scoped snapshot of the work you can resume fastest from customer-web.
                </CardDescription>
              </div>
              <StatusPill
                tone={
                  projectStatus === "error" || opsStatus === "error" || workspaceStatus === "error"
                    ? "danger"
                    : hasWorkspaceSurface
                      ? "success"
                      : "neutral"
                }
              >
                {hasWorkspaceSurface
                  ? (resolvedActiveOrganization?.slug ?? activeOrganization?.slug ?? "active")
                  : "locked"}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentSession ? (
              <p className="text-sm text-muted-foreground">
                Sign in to see your runs, pull requests, and available devboxes.
              </p>
            ) : !resolvedActiveOrganization ? (
              <p className="text-sm text-muted-foreground">
                Set an active organization above to unlock the customer-facing work surface.
              </p>
            ) : (
              <>
                {(projectError ?? opsError ?? workspaceError) ? (
                  <p className="text-sm text-destructive">
                    {projectError ?? opsError ?? workspaceError}
                  </p>
                ) : null}

                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{resumeSummary.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{resumeSummary.detail}</p>
                    </div>
                    <StatusPill tone={resumeSummary.tone}>{resumeSummary.label}</StatusPill>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <MetricTile
                    detail={memberRunScope?.description ?? "Member-scoped runs for your session."}
                    label="My runs"
                    tone={opsStatus === "error" ? "danger" : "success"}
                    value={String(runs.length)}
                  />
                  <MetricTile
                    detail="Pull request links recovered from your recent run artifacts."
                    label="Pull requests"
                    tone={
                      opsStatus === "error"
                        ? "danger"
                        : recentPullRequests.length > 0
                          ? "success"
                          : "neutral"
                    }
                    value={String(recentPullRequests.length)}
                  />
                  <MetricTile
                    detail={
                      latestRun
                        ? `${latestRun.title} · ${formatDate(latestRun.updatedAt ?? latestRun.createdAt)}`
                        : "No member-scoped run loaded yet."
                    }
                    label="Latest run"
                    tone={latestRun ? runTone(latestRun.status) : "neutral"}
                    value={latestRun?.status ?? "none"}
                  />
                  <MetricTile
                    detail="Workspace records with ready access or active status."
                    label="Ready devboxes"
                    tone={readyWorkspaceCount > 0 ? "success" : "neutral"}
                    value={String(readyWorkspaceCount)}
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  {latestRun ? (
                    <Button asChild type="button">
                      <Link params={{ runId: latestRun.id }} to="/runs/$runId">
                        Resume latest run
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild type="button">
                    <Link to="/runs">
                      <ClipboardList className="size-4" />
                      Open my runs
                    </Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/pull-requests">
                      <GitPullRequest className="size-4" />
                      Pull requests
                    </Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/organization">Organization</Link>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/account">Account</Link>
                  </Button>
                  {adminReturnHref ? (
                    <Button asChild type="button" variant="outline">
                      <a href={adminReturnHref}>Continue to admin</a>
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="size-5" />
                  Project access
                </CardTitle>
                <CardDescription>
                  Read-only project inventory and repository context for your active organization.
                </CardDescription>
              </div>
              <StatusPill tone={statusTone(projectStatus)}>{projectStatus}</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentSession ? (
              <p className="text-sm text-muted-foreground">
                Sign in to see the projects attached to your organization membership.
              </p>
            ) : !resolvedActiveOrganization ? (
              <p className="text-sm text-muted-foreground">
                Choose an active organization before loading project access.
              </p>
            ) : projectError ? (
              <p className="text-sm text-destructive">{projectError}</p>
            ) : recentProjects.length > 0 ? (
              recentProjects.map((project) => (
                <div
                  className="rounded-xl border border-border/60 bg-muted/20 p-4"
                  key={project.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="text-sm text-muted-foreground">{project.slug}</p>
                    </div>
                    <StatusPill tone={projectTone(project.status)}>{project.status}</StatusPill>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {project.description ? <p>{project.description}</p> : null}
                    <p>
                      Repo:{" "}
                      {formatRepository(project.repoProvider, project.repoOwner, project.repoName)}
                    </p>
                    <p>
                      Branch: {project.defaultBranch ?? "not set"} · Plan:{" "}
                      {project.billingPlan ?? "not set"}
                    </p>
                    <p>
                      Last run: {formatDate(project.lastRunAt)} · Workspaces:{" "}
                      {String(project.workspaceCount ?? 0)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No projects are visible for this organization yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Rocket className="size-5" />
                  Recent runs
                </CardTitle>
                <CardDescription>
                  Member-scoped run history with direct devbox, preview, and pull request jump-offs.
                </CardDescription>
              </div>
              <StatusPill tone={opsStatus === "error" ? "danger" : "success"}>
                {memberRunScope?.label ?? opsStatus}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentSession ? (
              <p className="text-sm text-muted-foreground">
                Sign in to review recent run outcomes and attached workspace access.
              </p>
            ) : !resolvedActiveOrganization ? (
              <p className="text-sm text-muted-foreground">
                Select an active organization to load recent runs.
              </p>
            ) : opsError ? (
              <p className="text-sm text-destructive">{opsError}</p>
            ) : recentRuns.length > 0 ? (
              recentRuns.map((run) => (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4" key={run.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{run.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {run.projectName ?? run.projectSlug ?? "Unassigned project"} ·{" "}
                        {formatDate(run.createdAt)}
                      </p>
                    </div>
                    <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    <p>
                      {(run.resultSummary ?? run.failureMessage ?? run.objective) ||
                        "No summary yet."}
                    </p>
                    <p>
                      Steps: {run.stepCounts.completed}/{run.stepCounts.total} complete · In
                      progress: {run.stepCounts.inProgress} · Failed: {run.stepCounts.failed}
                    </p>
                    <p>
                      Requested by: {run.requestedBy?.name ?? "Unknown"} · Source: {run.source}
                    </p>
                  </div>
                  {run.workspace?.ideUrl ||
                  run.workspace?.previewUrl ||
                  getRunPullRequestUrl(run) ? (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {getRunPullRequestUrl(run) ? (
                        <Button asChild type="button" variant="outline">
                          <a href={getRunPullRequestUrl(run)!} rel="noreferrer" target="_blank">
                            Open pull request
                          </a>
                        </Button>
                      ) : null}
                      {run.workspace?.ideUrl ? (
                        <Button asChild type="button" variant="outline">
                          <a href={run.workspace.ideUrl} rel="noreferrer" target="_blank">
                            Open devbox
                          </a>
                        </Button>
                      ) : null}
                      {run.workspace?.previewUrl ? (
                        <Button asChild type="button" variant="outline">
                          <a href={run.workspace.previewUrl} rel="noreferrer" target="_blank">
                            Open preview
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No runs are visible yet for this organization.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <GitPullRequest className="size-5" />
                  Pull request handoff
                </CardTitle>
                <CardDescription>
                  The fastest branch from customer-web into code review and admin follow-up.
                </CardDescription>
              </div>
              <StatusPill tone={recentPullRequests.length > 0 ? "success" : "neutral"}>
                {recentPullRequests.length}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentSession ? (
              <p className="text-sm text-muted-foreground">
                Sign in to see pull request evidence from your runs.
              </p>
            ) : !resolvedActiveOrganization ? (
              <p className="text-sm text-muted-foreground">
                Select an active organization to load pull request links.
              </p>
            ) : recentPullRequests.length > 0 ? (
              <>
                {recentPullRequests.map((run) => (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4" key={run.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{run.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {run.projectName ?? run.projectSlug ?? "Unassigned project"} ·{" "}
                          {formatDate(run.updatedAt ?? run.createdAt)}
                        </p>
                      </div>
                      <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {(run.resultSummary ?? run.objective) || "Pull request evidence attached."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button asChild type="button">
                        <a href={getRunPullRequestUrl(run)!} rel="noreferrer" target="_blank">
                          Open pull request
                        </a>
                      </Button>
                      <Button asChild type="button" variant="outline">
                        <Link to="/pull-requests">All pull requests</Link>
                      </Button>
                      {adminReturnHref ? (
                        <Button asChild type="button" variant="outline">
                          <a href={adminReturnHref}>Admin follow-up</a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  No recent member-scoped runs expose pull request evidence yet.
                </p>
                <Button asChild type="button" variant="outline">
                  <Link to="/runs">Review run history</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <ServerCog className="size-5" />
                  Devbox access
                </CardTitle>
                <CardDescription>
                  Ready workspace links stay read-only here and only appear when the provisioner has
                  exposed them.
                </CardDescription>
              </div>
              <StatusPill tone={statusTone(workspaceStatus)}>{workspaceStatus}</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentSession ? (
              <p className="text-sm text-muted-foreground">
                Sign in to see your current devboxes and available IDE links.
              </p>
            ) : !resolvedActiveOrganization ? (
              <p className="text-sm text-muted-foreground">
                Set an active organization before loading workspace access.
              </p>
            ) : workspaceError ? (
              <p className="text-sm text-destructive">{workspaceError}</p>
            ) : visibleWorkspaces.length > 0 ? (
              visibleWorkspaces.map((workspace) => (
                <div
                  className="rounded-xl border border-border/60 bg-muted/20 p-4"
                  key={`${workspace.projectSlug}-${workspace.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{workspace.projectName}</p>
                      <p className="text-sm text-muted-foreground">{workspace.workspaceId}</p>
                    </div>
                    <StatusPill tone={workspaceTone(workspace)}>{workspace.status}</StatusPill>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    <p>
                      Repo: {workspace.repoOwner}/{workspace.repoName} · Provider:{" "}
                      {workspace.provider}
                    </p>
                    <p>
                      Image: {workspace.imageFlavor} · Updated:{" "}
                      {formatDate(workspace.updatedAt ?? workspace.createdAt)}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {workspace.ideUrl ? (
                      <Button asChild type="button" variant="outline">
                        <a href={workspace.ideUrl} rel="noreferrer" target="_blank">
                          Open devbox
                        </a>
                      </Button>
                    ) : null}
                    {workspace.previewUrl ? (
                      <Button asChild type="button" variant="outline">
                        <a href={workspace.previewUrl} rel="noreferrer" target="_blank">
                          Open preview
                        </a>
                      </Button>
                    ) : null}
                  </div>
                  {!workspace.ideUrl && !workspace.previewUrl ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Access links appear here once the workspace reaches a ready state.
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No active devboxes yet. They will appear here after a run provisions a workspace.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-5" />
                  Recent activity
                </CardTitle>
                <CardDescription>
                  Organization-level context exposed by the internal API, kept secondary to your
                  member-scoped work queue.
                </CardDescription>
              </div>
              <StatusPill tone={statusTone(opsStatus)}>{recentActivity.length}</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentSession ? (
              <p className="text-sm text-muted-foreground">
                Sign in to see organization activity and recent changes.
              </p>
            ) : !resolvedActiveOrganization ? (
              <p className="text-sm text-muted-foreground">
                Choose an active organization to load recent activity.
              </p>
            ) : opsError ? (
              <p className="text-sm text-destructive">{opsError}</p>
            ) : recentActivity.length > 0 ? (
              recentActivity.map((entry) => (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4" key={entry.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{entry.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
                    </div>
                    <StatusPill tone={runTone(entry.status)}>{entry.status}</StatusPill>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {entry.kind} · {formatDate(entry.occurredAt)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No recent activity was returned for this organization.
              </p>
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
            {currentSession ? (
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
                  <Megaphone className="size-5" />
                  Service updates
                </CardTitle>
                <CardDescription>
                  Public API announcements and featured catalog items stay available, but tucked
                  below the member dashboard so they do not dominate the home route.
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
            {state.announcements.length === 0 && state.products.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {error ?? "No public updates returned yet."}
              </p>
            ) : (
              <>
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

                {state.products
                  .filter((product) => product.featured)
                  .map((product) => (
                    <div
                      className="rounded-xl border border-border/60 bg-muted/20 p-4"
                      key={product.id}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-sm text-muted-foreground">{product.slug}</p>
                        </div>
                        <StatusPill tone="success">{product.status}</StatusPill>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Featured catalog item · EUR {(product.priceCents / 100).toFixed(2)}
                      </p>
                    </div>
                  ))}

                <div className="flex flex-wrap gap-3">
                  <Button asChild type="button" variant="outline">
                    <a href={`${publicApiBasePath}/announcements`} rel="noreferrer" target="_blank">
                      Open announcements JSON
                    </a>
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <a href={`${publicApiBasePath}/products`} rel="noreferrer" target="_blank">
                      Open products JSON
                    </a>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function MetricTile({
  detail,
  label,
  tone,
  value,
}: {
  detail: string;
  label: string;
  tone: "danger" | "neutral" | "success" | "warning";
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <StatusPill tone={tone}>{value}</StatusPill>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
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

function formatRepository(
  provider: string | null | undefined,
  owner: string | null | undefined,
  repo: string | null | undefined,
) {
  if (!owner || !repo) {
    return "not configured";
  }

  return `${provider ?? "repo"} · ${owner}/${repo}`;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

const publicApiBasePath = "/api/public";

function getResumeSummary({
  latestAttentionRun,
  latestReadyWorkspace,
  latestRun,
  recentPullRequestCount,
}: {
  latestAttentionRun: RunRecord | null;
  latestReadyWorkspace: WorkspaceAccessItem | null;
  latestRun: RunRecord | null;
  recentPullRequestCount: number;
}) {
  if (latestAttentionRun) {
    return {
      detail:
        latestAttentionRun.failureMessage ??
        latestAttentionRun.resultSummary ??
        "This run needs a closer look before it can be considered done.",
      label: "attention",
      title: latestAttentionRun.title,
      tone: "danger" as const,
    };
  }

  if (recentPullRequestCount > 0) {
    return {
      detail: `${recentPullRequestCount} recent run(s) already expose pull request evidence.`,
      label: "review",
      title: "PR follow-up is ready",
      tone: "success" as const,
    };
  }

  if (latestReadyWorkspace) {
    return {
      detail: `${latestReadyWorkspace.projectName} has a ready workspace you can reopen from the organization page.`,
      label: "resume",
      title: "Devbox access is ready",
      tone: "success" as const,
    };
  }

  if (latestRun) {
    return {
      detail: latestRun.resultSummary ?? "The latest run is the best place to regain context.",
      label: latestRun.status,
      title: latestRun.title,
      tone: runTone(latestRun.status),
    };
  }

  return {
    detail: "No member-scoped run or ready workspace is visible yet.",
    label: "waiting",
    title: "Waiting for first work item",
    tone: "warning" as const,
  };
}
