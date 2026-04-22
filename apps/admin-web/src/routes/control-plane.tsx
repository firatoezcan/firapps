import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  FolderKanban,
  LayoutTemplate,
  RefreshCw,
  Rocket,
  ServerCog,
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
  cn,
} from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { buildCustomerSignInHref, getCurrentAdminPath } from "../lib/admin-sign-in-handoff";
import { authClient } from "../lib/auth-client";
import {
  type ActivityItem,
  type Deployment,
  type LoadStatus,
  type Overview,
  type Project,
  type Workspace,
  dispatchReadinessTone,
  deploymentTone,
  formatDate,
  getDispatchReadinessLabel,
  normalizeActivity,
  normalizeDeployments,
  normalizeOverview,
  normalizeProjects,
  normalizeWorkspaces,
  projectHasRepositoryRegistration,
  projectIsDispatchReady,
  requestInternalApi,
  statusTone,
  tenantTone,
  toErrorMessage,
  workspaceTone,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

export const Route = createFileRoute("/control-plane")({
  component: ControlPlaneRoute,
});

const emptyOverview: Overview = {
  activeRuns: 0,
  failedRuns: 0,
  pendingInvitations: 0,
  projectCount: 0,
  readyWorkspaces: 0,
  runCount: 0,
  workspaceCount: 0,
};

function ControlPlaneRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;

  const [projectStatus, setProjectStatus] = useState<LoadStatus>("idle");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  const [workspaceStatus, setWorkspaceStatus] = useState<LoadStatus>("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const [opsStatus, setOpsStatus] = useState<LoadStatus>("idle");
  const [opsError, setOpsError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const repoRegisteredProjects = useMemo(
    () => projects.filter((project) => projectHasRepositoryRegistration(project)),
    [projects],
  );
  const dispatchReadyProjects = useMemo(
    () => projects.filter((project) => projectIsDispatchReady(project)),
    [projects],
  );
  const readyDeployments = deployments.filter((deployment) => deployment.status === "ready");
  const signInHandoff = buildCustomerSignInHref(
    getCurrentAdminPath("/control-plane"),
    "/control-plane",
  );

  useEffect(() => {
    if (!session) {
      setProjectStatus("idle");
      setProjectError(null);
      setProjects([]);
      return;
    }

    if (!activeOrganization?.id) {
      setProjectStatus("ready");
      setProjectError(null);
      setProjects([]);
      return;
    }

    void refreshProjects();
  }, [activeOrganization?.id, session?.session.id]);

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setOpsStatus("idle");
      setOpsError(null);
      setOverview(emptyOverview);
      setActivity([]);
      setDeployments([]);
      return;
    }

    void refreshOperations();
  }, [activeOrganization?.id, session?.session.id]);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId("");
      return;
    }

    const selectionStillExists = projects.some((project) => project.id === selectedProjectId);

    if (!selectionStillExists) {
      setSelectedProjectId(projects[0]?.id ?? "");
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!session || !activeOrganization?.id || !selectedProjectId) {
      setWorkspaceStatus("idle");
      setWorkspaceError(null);
      setWorkspaces([]);
      return;
    }

    void refreshWorkspaces(selectedProjectId);
  }, [activeOrganization?.id, selectedProjectId, session?.session.id]);

  useEffect(() => {
    if (!sessionQuery.isPending && !session && typeof window !== "undefined") {
      window.location.replace(signInHandoff.href);
    }
  }, [session, sessionQuery.isPending, signInHandoff.href]);

  async function refreshProjects() {
    setProjectStatus("loading");
    setProjectError(null);

    try {
      const payload = (await requestInternalApi("/projects")) as {
        projects?: unknown[];
      } | null;

      setProjects(normalizeProjects(payload?.projects));
      setProjectStatus("ready");
    } catch (error) {
      setProjectStatus("error");
      setProjectError(toErrorMessage(error, "Unable to load projects."));
      setProjects([]);
    }
  }

  async function refreshWorkspaces(projectId: string) {
    setWorkspaceStatus("loading");
    setWorkspaceError(null);

    try {
      const payload = (await requestInternalApi(
        `/workspaces?tenantId=${encodeURIComponent(projectId)}`,
      )) as { workspaces?: unknown[] } | null;

      setWorkspaces(normalizeWorkspaces(payload?.workspaces));
      setWorkspaceStatus("ready");
    } catch (error) {
      setWorkspaceStatus("error");
      setWorkspaceError(toErrorMessage(error, "Unable to load workspace inventory."));
      setWorkspaces([]);
    }
  }

  async function refreshOperations() {
    setOpsStatus("loading");
    setOpsError(null);

    try {
      const [overviewPayload, activityPayload, deploymentsPayload] = await Promise.all([
        requestInternalApi("/overview"),
        requestInternalApi("/activity"),
        requestInternalApi("/deployments"),
      ]);

      setOverview(normalizeOverview((overviewPayload as { overview?: unknown } | null)?.overview));
      setActivity(
        normalizeActivity((activityPayload as { activity?: unknown[] } | null)?.activity),
      );
      setDeployments(
        normalizeDeployments(
          (deploymentsPayload as { deployments?: unknown[] } | null)?.deployments,
        ),
      );
      setOpsStatus("ready");
    } catch (error) {
      setOpsStatus("error");
      setOpsError(toErrorMessage(error, "Unable to load overview, activity, or deployments."));
      setOverview(emptyOverview);
      setActivity([]);
      setDeployments([]);
    }
  }

  async function refreshEverything() {
    await Promise.all([refreshProjects(), refreshOperations()]);

    if (selectedProjectId) {
      await refreshWorkspaces(selectedProjectId);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Project control plane"
      description="A focused SaaS control plane for projects, workspace runtime state, overview metrics, and release activity. It keeps the new internal-api surfaces visible without cutting into the existing dashboard."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh control plane"
            onClick={() => void refreshEverything()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button asChild type="button">
            <Link to="/blueprints">
              <LayoutTemplate className="size-4" />
              Blueprints
            </Link>
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/control-plane" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail={
            activeOrganization
              ? `${activeOrganization.name} is the active Better Auth organization.`
              : "Choose an active Better Auth organization to unlock project data."
          }
          label="Active organization"
          tone={activeOrganization ? "success" : "warning"}
          value={activeOrganization?.name ?? "none"}
        />
        <StatCard
          detail="Projects returned by `/api/internal/projects`."
          label="Projects"
          tone={statusTone(projectStatus)}
          value={String(overview.projectCount || projects.length)}
        />
        <StatCard
          detail="Ready workspace count from `/api/internal/overview`."
          label="Ready workspaces"
          tone={overview.readyWorkspaces > 0 ? "success" : statusTone(opsStatus)}
          value={String(overview.readyWorkspaces)}
        />
        <StatCard
          detail="Active queued/provisioning runs from `/api/internal/overview`."
          label="Active runs"
          tone={overview.activeRuns > 0 ? "warning" : statusTone(opsStatus)}
          value={String(overview.activeRuns)}
        />
      </SectionGrid>

      {session && activeOrganization ? (
        <SectionGrid className="xl:grid-cols-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FolderKanban className="size-5" />
                    Project setup
                  </CardTitle>
                  <CardDescription>
                    {projects.length === 0
                      ? "Register the first GitHub-backed project before you expect runs or PRs."
                      : dispatchReadyProjects.length > 0
                        ? "Repository registration and dispatch readiness are tracked separately. At least one project can dispatch unattended work."
                        : "Project records may exist, but unattended dispatch is still blocked until readiness checks pass."}
                  </CardDescription>
                </div>
                <StatusPill
                  tone={
                    dispatchReadyProjects.length > 0
                      ? "success"
                      : projects.length > 0
                        ? "warning"
                        : "warning"
                  }
                >
                  {dispatchReadyProjects.length > 0
                    ? "ready"
                    : projects.length > 0
                      ? "attention"
                      : "required"}
                </StatusPill>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {projects.length > 0
                  ? `${repoRegisteredProjects.length}/${projects.length} project record${projects.length === 1 ? "" : "s"} have repository registration, and ${dispatchReadyProjects.length}/${projects.length} can currently dispatch unattended work.`
                  : "Start with /projects so the MVP has a real repository, default branch, and billing contact to work from."}
              </p>
              <Button asChild type="button">
                <Link to="/projects">
                  {projects.length > 0 ? "Open projects" : "Register project"}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <LayoutTemplate className="size-5" />
                    Blueprint policy
                  </CardTitle>
                  <CardDescription>
                    Choose the default Blueprint that should drive the first unattended run.
                  </CardDescription>
                </div>
                <StatusPill tone={projects.length > 0 ? "warning" : "neutral"}>
                  {projects.length > 0 ? "next" : "waiting"}
                </StatusPill>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The MVP route order is explicit now: project first, Blueprint second, run dispatch
                third.
              </p>
              <Button asChild type="button" variant="outline">
                <Link to="/blueprints">Open blueprints</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Workflow className="size-5" />
                    First dispatch
                  </CardTitle>
                  <CardDescription>
                    Launch the next unattended run once the project and Blueprint are ready.
                  </CardDescription>
                </div>
                <StatusPill
                  tone={
                    overview.runCount > 0 ? "success" : projects.length > 0 ? "warning" : "neutral"
                  }
                >
                  {overview.runCount > 0 ? "running" : projects.length > 0 ? "ready" : "blocked"}
                </StatusPill>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {overview.runCount > 0
                  ? `${overview.runCount} run${overview.runCount === 1 ? "" : "s"} already visible. Resume from /runs or /queue.`
                  : "Use the run composer after project + Blueprint setup to generate the first reviewable artifact trail."}
              </p>
              <Button asChild type="button" variant={overview.runCount > 0 ? "outline" : "default"}>
                <Link to="/runs">{overview.runCount > 0 ? "Open runs" : "Dispatch first run"}</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Rocket className="size-5" />
                    Review and operate
                  </CardTitle>
                  <CardDescription>
                    Queue, activity, and founder surfaces stay grouped so launch proof is obvious.
                  </CardDescription>
                </div>
                <StatusPill
                  tone={
                    overview.failedRuns > 0
                      ? "danger"
                      : overview.runCount > 0 || activity.length > 0
                        ? "success"
                        : "neutral"
                  }
                >
                  {overview.failedRuns > 0
                    ? "attention"
                    : overview.runCount > 0 || activity.length > 0
                      ? "live"
                      : "idle"}
                </StatusPill>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Open the queue when work is active, then use pull requests, activity, and operator
                views as the launch-day release console.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" type="button" variant="outline">
                  <Link to="/queue">Open queue</Link>
                </Button>
                <Button asChild size="sm" type="button" variant="outline">
                  <Link to="/operators">Open operators</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </SectionGrid>
      ) : null}

      {!session ? (
        <Card>
          <CardHeader>
            <CardTitle>Redirecting to customer sign in</CardTitle>
            <CardDescription>
              This route now hands signed-out users back to customer-web so the shared Better Auth
              session can return them straight to the control plane instead of stopping on a dead
              end card.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Requested admin route: <code>{signInHandoff.returnPath}</code>
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild type="button">
                <a href={signInHandoff.href}>Open customer sign in</a>
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/">Admin landing</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <SectionGrid>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Project portfolio</CardTitle>
                <CardDescription>
                  Project rows from `/api/internal/projects`, including repository defaults,
                  dispatch readiness, and workflow mode.
                </CardDescription>
              </div>
              <StatusPill tone={statusTone(projectStatus)}>{projectStatus}</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {projectError ? <InlineNotice message={projectError} /> : null}
            <div className="space-y-3">
              {projects.map((project) => {
                const isSelected = project.id === selectedProjectId;

                return (
                  <div
                    className={cn(
                      "rounded-2xl border border-border/60 bg-muted/20 p-4",
                      isSelected && "border-primary/40 bg-primary/5",
                    )}
                    key={project.id}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">{project.slug}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill tone={tenantTone(project.status)}>{project.status}</StatusPill>
                        <StatusPill
                          tone={dispatchReadinessTone(
                            project.dispatchReadiness?.status,
                            project.dispatchReadiness?.dispatchReady,
                          )}
                        >
                          {getDispatchReadinessLabel(project.dispatchReadiness)}
                        </StatusPill>
                        <Button
                          onClick={() => setSelectedProjectId(project.id)}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                        >
                          {isSelected ? "Selected" : "Inspect"}
                        </Button>
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-foreground">Repository</dt>
                        <dd>
                          {project.repoProvider && project.repoOwner && project.repoName
                            ? `${project.repoProvider}:${project.repoOwner}/${project.repoName}`
                            : "not configured"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">Default branch</dt>
                        <dd>{project.defaultBranch ?? "main"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">Workflow mode</dt>
                        <dd>{project.workflowMode ?? "blueprint"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">Repository registration</dt>
                        <dd>
                          {projectHasRepositoryRegistration(project)
                            ? "configured"
                            : "still required"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">Dispatch readiness</dt>
                        <dd>
                          {project.dispatchReadiness?.detail ?? "No readiness detail returned."}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">Last run</dt>
                        <dd>{formatDate(project.lastRunAt)}</dd>
                      </div>
                    </dl>
                    {project.description ? (
                      <p className="mt-3 text-sm text-muted-foreground">{project.description}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {projectError ?? "No projects returned yet."}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Workspace inventory</CardTitle>
                <CardDescription>
                  Read-only runtime state for the selected project via `/api/internal/workspaces`.
                </CardDescription>
              </div>
              <StatusPill tone={statusTone(workspaceStatus)}>{workspaceStatus}</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspaceError ? <InlineNotice message={workspaceError} /> : null}
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Selected project</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedProject
                      ? `${selectedProject.name} (${selectedProject.slug})`
                      : "none selected"}
                  </p>
                </div>
                <StatusPill tone={overview.readyWorkspaces > 0 ? "success" : "neutral"}>
                  {overview.readyWorkspaces} ready
                </StatusPill>
              </div>
            </div>
            <div className="space-y-3">
              {workspaces.map((workspace) => (
                <div
                  className="rounded-2xl border border-border/60 bg-background/80 p-4"
                  key={workspace.id}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {workspace.name ?? `${workspace.repoOwner}/${workspace.repoName}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {workspace.repoProvider}:{workspace.repoOwner}/{workspace.repoName}
                      </p>
                    </div>
                    <StatusPill tone={workspaceTone(workspace)}>{workspace.status}</StatusPill>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-foreground">Provider</dt>
                      <dd>{workspace.provider}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Image flavor</dt>
                      <dd>{workspace.imageFlavor}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Updated</dt>
                      <dd>{formatDate(workspace.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Nix packages</dt>
                      <dd>
                        {workspace.nixPackages.length > 0
                          ? workspace.nixPackages.join(", ")
                          : "none"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {workspace.ideUrl ? (
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={workspace.ideUrl} rel="noreferrer" target="_blank">
                          <FolderKanban className="size-4" />
                          Open devbox
                        </a>
                      </Button>
                    ) : null}
                    {workspace.previewUrl ? (
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={workspace.previewUrl} rel="noreferrer" target="_blank">
                          <Rocket className="size-4" />
                          Preview
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {selectedProject
                  ? (workspaceError ?? "No workspaces returned for the selected project.")
                  : "Select a project to load its workspace inventory."}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Overview and release signal</CardTitle>
                <CardDescription>
                  The new overview and deployment endpoints provide a compact operator summary.
                </CardDescription>
              </div>
              <StatusPill tone={statusTone(opsStatus)}>{opsStatus}</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {opsError ? <InlineNotice message={opsError} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniStat label="Runs" value={String(overview.runCount)} />
              <MiniStat label="Failed runs" value={String(overview.failedRuns)} />
              <MiniStat label="Pending invitations" value={String(overview.pendingInvitations)} />
              <MiniStat label="Ready deployments" value={String(readyDeployments.length)} />
            </div>
            <div className="space-y-3">
              {deployments.map((deployment) => (
                <div
                  className="rounded-2xl border border-border/60 bg-background/80 p-4"
                  key={deployment.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{deployment.environment}</p>
                      <p className="text-sm text-muted-foreground">Tenant: {deployment.tenantId}</p>
                    </div>
                    <StatusPill tone={deploymentTone(deployment.status)}>
                      {deployment.status}
                    </StatusPill>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Version: {deployment.version}
                  </p>
                </div>
              ))}
            </div>
            {deployments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {opsError ?? "No deployment records returned yet."}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>
                  Project, workspace, run, and invitation events from `/api/internal/activity`.
                </CardDescription>
              </div>
              <StatusPill tone={activity.length > 0 ? "success" : statusTone(opsStatus)}>
                {activity.length} events
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.map((event) => (
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4" key={event.id}>
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-border/60 bg-background/90 p-2">
                    <Activity className="size-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{event.title}</p>
                      <StatusPill tone={tenantTone(event.status)}>{event.kind}</StatusPill>
                    </div>
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(event.occurredAt)}</p>
                  </div>
                </div>
              </div>
            ))}
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {opsError ?? "No activity events returned yet."}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle>Control-plane next steps</CardTitle>
            <CardDescription>
              The new endpoints let the admin surface split into clearer product areas without
              collapsing everything back into the dashboard route.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <ActionTile
              description="Use the real `/blueprints` registry and blueprint creation flow."
              icon={LayoutTemplate}
              title="Blueprint dispatch"
              to="/blueprints"
            />
            <ActionTile
              description="Use `/runs`, `/runs/:runId`, and activity to track execution and results."
              icon={Workflow}
              title="Runs and results"
              to="/runs"
            />
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function ActionTile({
  description,
  icon: Icon,
  title,
  to,
}: {
  description: string;
  icon: typeof ServerCog;
  title: string;
  to: "/blueprints" | "/runs";
}) {
  return (
    <Link
      className="rounded-2xl border border-border/60 bg-background/90 p-4 transition hover:border-primary/40 hover:bg-primary/5"
      to={to}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
          <Icon className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function InlineNotice({ message }: { message: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-900 dark:text-red-100",
      )}
    >
      {message}
    </div>
  );
}
