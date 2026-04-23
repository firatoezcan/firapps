import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ClipboardList,
  ExternalLink,
  LayoutTemplate,
  RefreshCw,
  RotateCcw,
  Rocket,
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
import {
  createAdminRun,
  createAdminSidechannelDispatch,
  retryAdminRun,
  useAdminActivity,
  useAdminBlueprints,
  useAdminOverview,
  useAdminProjects,
  useAdminRunDetail,
  useAdminRuns,
} from "../lib/admin-product-data";
import { authClient } from "../lib/auth-client";
import {
  type ActivityItem,
  type Overview,
  type RunArtifact,
  type RunEvent,
  type RunRecord,
  type RunStepRecord,
  canRetryRun,
  formatDate,
  getRunLastActivityAt,
  getRunOperatorSummary,
  getRunPullRequestUrl,
  getRunRetryActionLabel,
  runTone,
  statusTone,
  tenantTone,
  toErrorMessage,
  workspaceTone,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

export const Route = createFileRoute("/runs")({
  component: RunsRoute,
});

const defaultRunForm = {
  objective: "",
  source: "manual",
  title: "",
};

const defaultSidechannelForm = {
  channelName: "launch-ops",
  objective: "",
  requestedByName: "",
  title: "",
  webhookSecret: "",
};

function RunsRoute() {
  const location = useLocation();
  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  const handoffSearch = useMemo(() => {
    const searchParams = new URLSearchParams(currentSearch);

    return {
      blueprintId: searchParams.get("blueprintId") ?? undefined,
      projectId: searchParams.get("projectId") ?? undefined,
    };
  }, [currentSearch]);
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canDispatchRuns = activeRole === "owner" || activeRole === "admin";

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [appliedHandoffProjectId, setAppliedHandoffProjectId] = useState<string | null>(null);
  const [appliedHandoffBlueprintId, setAppliedHandoffBlueprintId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);
  const [form, setForm] = useState(defaultRunForm);
  const [sidechannelForm, setSidechannelForm] = useState(defaultSidechannelForm);
  const productCollectionsEnabled = Boolean(session && activeOrganization?.id);
  const projectsQuery = useAdminProjects(productCollectionsEnabled, activeOrganization?.id);
  const blueprintsQuery = useAdminBlueprints(productCollectionsEnabled, activeOrganization?.id);
  const runsQuery = useAdminRuns(
    productCollectionsEnabled,
    activeOrganization?.id,
    selectedProjectId || undefined,
  );
  const detailQuery = useAdminRunDetail(
    productCollectionsEnabled && Boolean(selectedRunId),
    activeOrganization?.id,
    selectedRunId,
  );
  const overviewQuery = useAdminOverview(productCollectionsEnabled, activeOrganization?.id);
  const activityQuery = useAdminActivity(productCollectionsEnabled, activeOrganization?.id);
  const projectError = projectsQuery.error;
  const projects = projectsQuery.rows;
  const blueprintError = blueprintsQuery.error;
  const blueprints = blueprintsQuery.rows;
  const runStatus = runsQuery.status;
  const runError = runsQuery.error;
  const runs = runsQuery.rows;
  const detailStatus = detailQuery.status;
  const detailError = detailQuery.error;
  const selectedRun = detailQuery.run;
  const opsStatus =
    overviewQuery.status === "error" || activityQuery.status === "error"
      ? "error"
      : overviewQuery.status === "loading" || activityQuery.status === "loading"
        ? "loading"
        : overviewQuery.status === "ready" && activityQuery.status === "ready"
          ? "ready"
          : "idle";
  const opsError = overviewQuery.error ?? activityQuery.error;
  const overview: Overview = overviewQuery.overview;
  const activity: ActivityItem[] = activityQuery.rows;

  if (location.pathname !== "/runs") {
    return <Outlet />;
  }

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedBlueprint = useMemo(
    () => blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? null,
    [blueprints, selectedBlueprintId],
  );
  const selectedRunPullRequestUrl = selectedRun ? getRunPullRequestUrl(selectedRun) : null;
  const signInHandoff = buildCustomerSignInHref(getCurrentAdminPath("/runs"), "/runs");

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
    if (!handoffSearch.projectId || projects.length === 0) {
      return;
    }

    if (appliedHandoffProjectId === handoffSearch.projectId) {
      return;
    }

    const handoffProjectExists = projects.some((project) => project.id === handoffSearch.projectId);

    if (!handoffProjectExists) {
      return;
    }

    setSelectedProjectId(handoffSearch.projectId);
    setAppliedHandoffProjectId(handoffSearch.projectId);
  }, [appliedHandoffProjectId, handoffSearch.projectId, projects]);

  useEffect(() => {
    if (blueprints.length === 0) {
      setSelectedBlueprintId("");
      return;
    }

    const selectionStillExists = blueprints.some(
      (blueprint) => blueprint.id === selectedBlueprintId,
    );

    if (!selectionStillExists) {
      setSelectedBlueprintId(blueprints[0]?.id ?? "");
    }
  }, [blueprints, selectedBlueprintId]);

  useEffect(() => {
    if (!handoffSearch.blueprintId || blueprints.length === 0) {
      return;
    }

    if (appliedHandoffBlueprintId === handoffSearch.blueprintId) {
      return;
    }

    const handoffBlueprintExists = blueprints.some(
      (blueprint) => blueprint.id === handoffSearch.blueprintId,
    );

    if (!handoffBlueprintExists) {
      return;
    }

    setSelectedBlueprintId(handoffSearch.blueprintId);
    setAppliedHandoffBlueprintId(handoffSearch.blueprintId);
  }, [appliedHandoffBlueprintId, blueprints, handoffSearch.blueprintId]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId("");
      return;
    }

    const selectionStillExists = runs.some((run) => run.id === selectedRunId);

    if (!selectionStillExists) {
      setSelectedRunId(runs[0]?.id ?? "");
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!sessionQuery.isPending && !session && typeof window !== "undefined") {
      window.location.replace(signInHandoff.href);
    }
  }, [session, sessionQuery.isPending, signInHandoff.href]);

  useEffect(() => {
    if (selectedProject && form.title.trim().length === 0) {
      setForm((current) => ({
        ...current,
        title: `Implement work for ${selectedProject.name}`,
      }));
    }
  }, [selectedProject, form.title]);

  useEffect(() => {
    if (!session) {
      return;
    }

    setSidechannelForm((current) =>
      current.requestedByName.trim().length > 0
        ? current
        : {
            ...current,
            requestedByName: session.user.name?.trim() || session.user.email,
          },
    );
  }, [session?.session.id, session?.user.email, session?.user.name]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setSidechannelForm((current) =>
      current.title.trim().length > 0
        ? current
        : {
            ...current,
            title: `Slack dispatch for ${selectedProject.name}`,
          },
    );
  }, [selectedProject?.id, selectedProject?.name]);

  async function refreshReferenceData() {
    await Promise.all([
      projectsQuery.refresh(),
      blueprintsQuery.refresh(),
      overviewQuery.refresh(),
      activityQuery.refresh(),
    ]);
  }

  async function refreshEverything() {
    await Promise.all([refreshReferenceData(), runsQuery.refresh()]);

    if (selectedRunId) {
      await detailQuery.refresh();
    }
  }

  async function handleCreateRun() {
    if (!selectedProjectId) {
      setNotice({
        message: "Select a project before dispatching a run.",
        tone: "danger",
      });
      return;
    }

    setBusyAction("create-run");
    setNotice(null);

    try {
      const createdRun = await createAdminRun(
        {
          blueprintId: selectedBlueprintId || null,
          objective: form.objective.trim(),
          source: form.source,
          tenantId: selectedProjectId,
          title: form.title.trim(),
        },
        selectedProjectId,
      );

      setNotice({
        message: "Run dispatched into the isolated devbox pipeline.",
        tone: "success",
      });
      setForm({
        ...defaultRunForm,
        title: selectedProject ? `Implement work for ${selectedProject.name}` : "",
      });

      if (createdRun) {
        setSelectedRunId(createdRun.id);
      }
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to dispatch the run."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateSidechannelDispatch() {
    if (!canDispatchRuns) {
      return;
    }

    if (!activeOrganization?.slug) {
      setNotice({
        message: "Select an active organization before dispatching from a sidechannel.",
        tone: "danger",
      });
      return;
    }

    if (!selectedProject || !selectedBlueprint) {
      setNotice({
        message: "Select both a project and blueprint before using the sidechannel dispatch path.",
        tone: "danger",
      });
      return;
    }

    if (sidechannelForm.webhookSecret.trim().length === 0) {
      setNotice({
        message: "Enter the local dispatch secret before submitting the sidechannel command.",
        tone: "danger",
      });
      return;
    }

    if (
      sidechannelForm.title.trim().length === 0 ||
      sidechannelForm.objective.trim().length === 0
    ) {
      setNotice({
        message: "Sidechannel dispatch still needs both a title and objective.",
        tone: "danger",
      });
      return;
    }

    setBusyAction("create-sidechannel-run");
    setNotice(null);

    try {
      const createdRun = await createAdminSidechannelDispatch(
        {
          blueprintSlug: selectedBlueprint.slug,
          channelName: sidechannelForm.channelName.trim() || "launch-ops",
          objective: sidechannelForm.objective.trim(),
          organizationSlug: activeOrganization.slug,
          projectSlug: selectedProject.slug,
          requestedByName:
            sidechannelForm.requestedByName.trim() ||
            session?.user.name?.trim() ||
            session?.user.email ||
            "Operator",
          title: sidechannelForm.title.trim(),
          userId: session?.user.id ?? "ULOCAL",
          webhookSecret: sidechannelForm.webhookSecret.trim(),
        },
        selectedProjectId,
      );

      setNotice({
        message: "Slack-style sidechannel dispatch accepted.",
        tone: "success",
      });
      setSidechannelForm((current) => ({
        ...current,
        objective: "",
        title: selectedProject ? `Slack dispatch for ${selectedProject.name}` : "",
      }));

      if (createdRun) {
        setSelectedRunId(createdRun.id);
      }
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to submit the sidechannel dispatch."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRetryRun(run: RunRecord) {
    setRetryingRunId(run.id);
    setNotice(null);

    try {
      const retriedRun = await retryAdminRun(run.id, run.tenantId);

      setNotice({
        message: retriedRun
          ? `${getRunRetryActionLabel(run)} queued as ${retriedRun.title}.`
          : `${getRunRetryActionLabel(run)} accepted.`,
        tone: "success",
      });

      setSelectedProjectId(run.tenantId);

      if (retriedRun) {
        setSelectedRunId(retriedRun.id);
      }
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to re-dispatch the selected run."),
        tone: "danger",
      });
    } finally {
      setRetryingRunId(null);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Runs and results"
      description="Dispatch unattended work, inspect run detail from `/api/internal/runs/:runId`, review run events and artifacts, and retry or re-dispatch finished runs through the backend path that already exists."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/control-plane">
              <ArrowRight className="size-4 rotate-180" />
              Control plane
            </Link>
          </Button>
          <Button
            aria-label="Refresh runs"
            onClick={() => void refreshEverything()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button asChild type="button" variant="outline">
            <Link to="/blueprints">
              <LayoutTemplate className="size-4" />
              Blueprints
            </Link>
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/runs" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Recent run rows from `/api/internal/runs`."
          label="Run queue"
          tone={statusTone(runStatus)}
          value={String(runs.length)}
        />
        <StatCard
          detail="Queued, provisioning, and workspace-ready runs from `/api/internal/overview`."
          label="Active runs"
          tone={statusTone(opsStatus)}
          value={String(overview.activeRuns)}
        />
        <StatCard
          detail="Failed dispatches or execution-bridge blockers."
          label="Failed runs"
          tone={overview.failedRuns > 0 ? "danger" : "neutral"}
          value={String(overview.failedRuns)}
        />
        <StatCard
          detail="The currently selected run detail payload."
          label="Selected status"
          tone={selectedRun ? runTone(selectedRun.status) : "warning"}
          value={selectedRun?.status ?? "none"}
        />
      </SectionGrid>

      {!session ? (
        <Card>
          <CardHeader>
            <CardTitle>Redirecting to customer sign in</CardTitle>
            <CardDescription>
              Signed-out access to the runs surface now forwards through customer-web so the real
              sign-in flow can restore the shared Better Auth session before returning here.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Requested admin route: <code>{signInHandoff.returnPath}</code>
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild type="button">
                <a href={signInHandoff.href}>Open customer sign in</a>
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/control-plane">Control plane</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <SectionGrid>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Rocket className="size-5" />
                      Dispatch run
                    </CardTitle>
                    <CardDescription>
                      Queue unattended work for a selected project and blueprint. The backend writes
                      the run, step records, workspace state, and later detail pages consume the
                      same contract directly.
                    </CardDescription>
                  </div>
                  <StatusPill tone={canDispatchRuns ? "success" : "warning"}>
                    {canDispatchRuns ? "dispatch enabled" : "read only"}
                  </StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}
                {projectError ? <InlineNotice message={projectError} tone="danger" /> : null}
                {blueprintError ? <InlineNotice message={blueprintError} tone="danger" /> : null}
                {handoffSearch.projectId || handoffSearch.blueprintId ? (
                  <InlineNotice
                    message={`Blueprint handoff ready: ${selectedProject?.name ?? "project pending"} + ${selectedBlueprint?.name ?? "blueprint pending"}.`}
                    tone="success"
                  />
                ) : null}

                <LabeledField label="Project">
                  <select
                    className={inputClassName}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                    value={selectedProjectId}
                  >
                    {projects.length === 0 ? <option value="">No projects returned</option> : null}
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.slug})
                      </option>
                    ))}
                  </select>
                </LabeledField>

                <LabeledField label="Blueprint">
                  <select
                    className={inputClassName}
                    onChange={(event) => setSelectedBlueprintId(event.target.value)}
                    value={selectedBlueprintId}
                  >
                    {blueprints.length === 0 ? (
                      <option value="">No blueprints returned</option>
                    ) : null}
                    {blueprints.map((blueprint) => (
                      <option key={blueprint.id} value={blueprint.id}>
                        {blueprint.name} ({blueprint.scope})
                      </option>
                    ))}
                  </select>
                </LabeledField>

                <LabeledField label="Dispatch source">
                  <select
                    className={inputClassName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        source: event.target.value,
                      }))
                    }
                    value={form.source}
                  >
                    <option value="manual">manual</option>
                    <option value="slack">slack</option>
                    <option value="email">email</option>
                    <option value="webhook">webhook</option>
                  </select>
                </LabeledField>

                <LabeledField label="Run title">
                  <input
                    className={inputClassName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Implement the requested backlog item"
                    value={form.title}
                  />
                </LabeledField>

                <LabeledField label="Objective">
                  <textarea
                    className={cn(inputClassName, "min-h-32 py-3")}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        objective: event.target.value,
                      }))
                    }
                    placeholder="Describe the change that should turn into a reviewable PR outcome."
                    value={form.objective}
                  />
                </LabeledField>

                <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {selectedProject?.name ?? "No project selected"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {selectedBlueprint
                          ? `${selectedBlueprint.name} will seed the run steps.`
                          : "Select a blueprint to make the run contract explicit."}
                      </p>
                    </div>
                    <StatusPill tone={tenantTone(selectedProject?.status ?? "unknown")}>
                      {selectedProject?.status ?? "unknown"}
                    </StatusPill>
                  </div>
                  <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-foreground">Organization</dt>
                      <dd>{activeOrganization?.name ?? "none"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Workflow mode</dt>
                      <dd>{selectedProject?.workflowMode ?? "blueprint"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Repository</dt>
                      <dd>
                        {selectedProject?.repoProvider &&
                        selectedProject.repoOwner &&
                        selectedProject.repoName
                          ? `${selectedProject.repoProvider}:${selectedProject.repoOwner}/${selectedProject.repoName}`
                          : "repository not configured"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Workspace footprint</dt>
                      <dd>{selectedProject?.workspaceCount ?? 0} cached devboxes</dd>
                    </div>
                  </dl>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busyAction === "create-run" ||
                      !canDispatchRuns ||
                      !selectedProjectId ||
                      !selectedBlueprintId ||
                      form.title.trim().length === 0 ||
                      form.objective.trim().length === 0
                    }
                    onClick={() => void handleCreateRun()}
                    type="button"
                  >
                    <Rocket className="size-4" />
                    {busyAction === "create-run" ? "Dispatching..." : "Dispatch run"}
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <Link to="/blueprints">
                      <LayoutTemplate className="size-4" />
                      Manage blueprints
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="size-5" />
                      Sidechannel dispatch
                    </CardTitle>
                    <CardDescription>
                      A product-facing Slack-style dispatch surface for the local MVP. It uses the
                      selected organization, project, and blueprint above instead of requiring a raw
                      API or proof-script call.
                    </CardDescription>
                  </div>
                  <StatusPill tone={canDispatchRuns ? "warning" : "neutral"}>
                    {canDispatchRuns ? "slack-style path" : "read only"}
                  </StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {selectedProject && selectedBlueprint
                      ? `${selectedProject.name} · ${selectedBlueprint.name}`
                      : "Select a project and blueprint first"}
                  </p>
                  <p className="mt-2">
                    This form sends a Slack-style command into the same dispatch boundary the local
                    webhook proof uses. Keep the local dispatch secret handy and treat this as the
                    operator-facing sidechannel surface for the MVP.
                  </p>
                </div>

                <LabeledField label="Requester display name">
                  <input
                    className={inputClassName}
                    disabled={!canDispatchRuns}
                    onChange={(event) =>
                      setSidechannelForm((current) => ({
                        ...current,
                        requestedByName: event.target.value,
                      }))
                    }
                    placeholder="Owner Example"
                    value={sidechannelForm.requestedByName}
                  />
                </LabeledField>

                <LabeledField label="Sidechannel channel">
                  <input
                    className={inputClassName}
                    disabled={!canDispatchRuns}
                    onChange={(event) =>
                      setSidechannelForm((current) => ({
                        ...current,
                        channelName: event.target.value,
                      }))
                    }
                    placeholder="launch-ops"
                    value={sidechannelForm.channelName}
                  />
                </LabeledField>

                <LabeledField label="Dispatch secret">
                  <input
                    className={inputClassName}
                    disabled={!canDispatchRuns}
                    onChange={(event) =>
                      setSidechannelForm((current) => ({
                        ...current,
                        webhookSecret: event.target.value,
                      }))
                    }
                    placeholder="Enter FIRAPPS_DISPATCH_WEBHOOK_SECRET"
                    type="password"
                    value={sidechannelForm.webhookSecret}
                  />
                </LabeledField>

                <LabeledField label="Sidechannel title">
                  <input
                    className={inputClassName}
                    disabled={!canDispatchRuns}
                    onChange={(event) =>
                      setSidechannelForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Slack dispatch for the selected project"
                    value={sidechannelForm.title}
                  />
                </LabeledField>

                <LabeledField label="Sidechannel objective">
                  <textarea
                    className={cn(inputClassName, "min-h-28 py-3")}
                    disabled={!canDispatchRuns}
                    onChange={(event) =>
                      setSidechannelForm((current) => ({
                        ...current,
                        objective: event.target.value,
                      }))
                    }
                    placeholder="Describe the work request that arrived through the sidechannel path."
                    value={sidechannelForm.objective}
                  />
                </LabeledField>

                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Command preview</p>
                  <p className="mt-2 break-words">
                    {selectedProject && selectedBlueprint && activeOrganization?.slug
                      ? `/dispatch organization=${activeOrganization.slug};project=${selectedProject.slug};blueprint=${selectedBlueprint.slug};title=${sidechannelForm.title || "..."};objective=${sidechannelForm.objective || "..."}`
                      : "Select an organization, project, and blueprint to preview the sidechannel command."}
                  </p>
                </div>

                <Button
                  disabled={
                    busyAction === "create-sidechannel-run" ||
                    !canDispatchRuns ||
                    !selectedProject ||
                    !selectedBlueprint ||
                    sidechannelForm.requestedByName.trim().length === 0 ||
                    sidechannelForm.webhookSecret.trim().length === 0 ||
                    sidechannelForm.title.trim().length === 0 ||
                    sidechannelForm.objective.trim().length === 0
                  }
                  onClick={() => void handleCreateSidechannelDispatch()}
                  type="button"
                  variant="outline"
                >
                  <Activity className="size-4" />
                  {busyAction === "create-sidechannel-run"
                    ? "Submitting sidechannel..."
                    : "Dispatch from sidechannel"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ClipboardList className="size-5" />
                      Recent runs
                    </CardTitle>
                    <CardDescription>
                      Read the current queue from `/api/internal/runs` and select a run to inspect
                      its steps, artifacts, lifecycle events, and retry path.
                    </CardDescription>
                  </div>
                  <StatusPill tone={statusTone(runStatus)}>{runStatus}</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {runError ? <InlineNotice message={runError} tone="danger" /> : null}
                {runs.map((run) => {
                  const isSelected = run.id === selectedRunId;

                  return (
                    <div
                      className={cn(
                        "rounded-2xl border border-border/60 bg-background/90 p-4 transition hover:border-primary/40 hover:bg-primary/5",
                        isSelected && "border-primary/40 bg-primary/5",
                      )}
                      key={run.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-medium">{run.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {run.projectName ?? run.projectSlug ?? run.tenantId}
                          </p>
                        </div>
                        <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                        {getRunOperatorSummary(run)}
                      </p>
                      <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        <MiniStat label="Queued" value={String(run.stepCounts.queued)} />
                        <MiniStat label="Completed" value={String(run.stepCounts.completed)} />
                        <MiniStat label="Failed" value={String(run.stepCounts.failed)} />
                        <MiniStat label="In progress" value={String(run.stepCounts.inProgress)} />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          onClick={() => setSelectedRunId(run.id)}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                        >
                          {isSelected ? "Inspecting below" : "Inspect below"}
                        </Button>
                        <Button asChild type="button" variant="outline">
                          <Link
                            params={{ runId: run.id }}
                            search={{
                              blueprintId: handoffSearch.blueprintId,
                              projectId: handoffSearch.projectId,
                            }}
                            to="/runs/$runId"
                          >
                            Open detail page
                          </Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {runError ?? "No runs returned for the current filter yet."}
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
                    <CardTitle className="flex items-center gap-2">
                      <Workflow className="size-5" />
                      Run detail
                    </CardTitle>
                    <CardDescription>
                      Selected execution summary, step timeline, events, artifacts, and the retry
                      path behind `/api/internal/runs/:runId` plus `/retry`.
                    </CardDescription>
                  </div>
                  <StatusPill tone={statusTone(detailStatus)}>{detailStatus}</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {detailError ? <InlineNotice message={detailError} tone="danger" /> : null}

                {selectedRun ? (
                  <>
                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-medium">{selectedRun.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedRun.projectName ?? selectedRun.tenantId}
                            {selectedRun.blueprintName ? ` • ${selectedRun.blueprintName}` : ""}
                          </p>
                        </div>
                        <StatusPill tone={runTone(selectedRun.status)}>
                          {selectedRun.status}
                        </StatusPill>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{selectedRun.objective}</p>
                      <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt className="font-medium text-foreground">Requested by</dt>
                          <dd>{selectedRun.requestedBy?.email ?? "unknown"}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">Source</dt>
                          <dd>{selectedRun.source}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">Queued</dt>
                          <dd>{formatDate(selectedRun.queuedAt ?? selectedRun.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">Started</dt>
                          <dd>{formatDate(selectedRun.startedAt)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">Completed</dt>
                          <dd>{formatDate(selectedRun.completedAt)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">Last activity</dt>
                          <dd>{formatDate(getRunLastActivityAt(selectedRun))}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">Result</dt>
                          <dd>{getRunOperatorSummary(selectedRun)}</dd>
                        </div>
                      </dl>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {canDispatchRuns && canRetryRun(selectedRun) ? (
                          <Button
                            disabled={retryingRunId === selectedRun.id}
                            onClick={() => void handleRetryRun(selectedRun)}
                            type="button"
                            variant="outline"
                          >
                            <RotateCcw className="size-4" />
                            {retryingRunId === selectedRun.id
                              ? "Submitting..."
                              : getRunRetryActionLabel(selectedRun)}
                          </Button>
                        ) : null}
                        {selectedRunPullRequestUrl ? (
                          <Button asChild type="button" variant="outline">
                            <a href={selectedRunPullRequestUrl} rel="noreferrer" target="_blank">
                              <ExternalLink className="size-4" />
                              Open pull request
                            </a>
                          </Button>
                        ) : null}
                        <Button asChild type="button" variant="outline">
                          <Link
                            params={{ runId: selectedRun.id }}
                            search={{
                              blueprintId: handoffSearch.blueprintId,
                              projectId: handoffSearch.projectId,
                            }}
                            to="/runs/$runId"
                          >
                            Open detail page
                          </Link>
                        </Button>
                        {selectedRun.workspace?.ideUrl ? (
                          <Button asChild type="button" variant="outline">
                            <a href={selectedRun.workspace.ideUrl} rel="noreferrer" target="_blank">
                              Open devbox
                            </a>
                          </Button>
                        ) : null}
                      </div>
                      {!canRetryRun(selectedRun) ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                          Re-dispatch stays disabled while the run is still active in the backend.
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-foreground">Execution steps</p>
                        {selectedRun.steps?.length ? (
                          selectedRun.steps.map((step) => <StepCard key={step.id} step={step} />)
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No detailed steps returned for this run yet.
                          </p>
                        )}
                      </div>

                      <div className="space-y-3">
                        <p className="text-sm font-medium text-foreground">
                          Artifacts and workspace
                        </p>
                        <ArtifactPanel artifacts={selectedRun.artifacts ?? []} />
                        <RunEventPanel events={selectedRun.events ?? []} />
                        {selectedRun.workspace ? (
                          <div className="rounded-2xl border border-border/60 bg-background/90 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="space-y-1">
                                <p className="font-medium">
                                  {selectedRun.workspace.repoOwner}/{selectedRun.workspace.repoName}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Workspace ID: {selectedRun.workspace.workspaceId}
                                </p>
                              </div>
                              <StatusPill tone={workspaceTone(selectedRun.workspace)}>
                                {selectedRun.workspace.status}
                              </StatusPill>
                            </div>
                            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                              <p>Provider: {selectedRun.workspace.provider}</p>
                              <p>Image flavor: {selectedRun.workspace.imageFlavor}</p>
                              <p>
                                Nix packages:{" "}
                                {selectedRun.workspace.nixPackages.length > 0
                                  ? selectedRun.workspace.nixPackages.join(", ")
                                  : "none requested"}
                              </p>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              {selectedRun.workspace.ideUrl ? (
                                <Button asChild type="button" variant="outline">
                                  <a
                                    href={selectedRun.workspace.ideUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Open devbox
                                  </a>
                                </Button>
                              ) : (
                                <p className="self-center text-sm text-muted-foreground">
                                  Devbox IDE URL pending.
                                </p>
                              )}
                              {selectedRunPullRequestUrl ? (
                                <Button asChild type="button" variant="outline">
                                  <a
                                    href={selectedRunPullRequestUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Open pull request
                                  </a>
                                </Button>
                              ) : (
                                <p className="self-center text-sm text-muted-foreground">
                                  No pull request URL has been attached to this run yet.
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No workspace was attached to this run yet.
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a run to load its detail surface.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="size-5" />
                      Overview and activity
                    </CardTitle>
                    <CardDescription>
                      Current organization throughput and the latest product events from the new
                      internal activity stream.
                    </CardDescription>
                  </div>
                  <StatusPill tone={statusTone(opsStatus)}>{opsStatus}</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {opsError ? <InlineNotice message={opsError} tone="danger" /> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniStat label="Projects" value={String(overview.projectCount)} />
                  <MiniStat label="Runs" value={String(overview.runCount)} />
                  <MiniStat label="Ready devboxes" value={String(overview.readyWorkspaces)} />
                  <MiniStat label="Pending invites" value={String(overview.pendingInvitations)} />
                </div>

                <div className="space-y-3">
                  {activity.map((event) => (
                    <div
                      className="rounded-2xl border border-border/60 bg-muted/20 p-4"
                      key={event.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-medium">{event.title}</p>
                          <p className="text-sm text-muted-foreground">{event.description}</p>
                        </div>
                        <StatusPill tone={runTone(event.status)}>{event.status}</StatusPill>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <span>{event.kind}</span>
                        <span>{formatDate(event.occurredAt)}</span>
                      </div>
                    </div>
                  ))}
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {opsError ?? "No activity returned yet."}
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </SectionGrid>
        </>
      )}
    </AppPage>
  );
}

function StepCard({ step }: { step: RunStepRecord }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/90 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium">{step.label}</p>
          <p className="text-sm text-muted-foreground">
            {step.stepKey} • {step.stepKind}
          </p>
        </div>
        <StatusPill tone={runTone(step.status)}>{step.status}</StatusPill>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {step.details ?? "No additional detail recorded yet."}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Step {step.position + 1} • updated {formatDate(step.updatedAt)}
      </p>
    </div>
  );
}

function ArtifactPanel({ artifacts }: { artifacts: RunArtifact[] }) {
  if (artifacts.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
        No artifacts have been attached to this run yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {artifacts.map((artifact) => (
        <div className="rounded-2xl border border-border/60 bg-background/90 p-4" key={artifact.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium">{artifact.label}</p>
              <p className="text-sm text-muted-foreground">{artifact.artifactType}</p>
            </div>
            <span className="text-xs text-muted-foreground">{formatDate(artifact.createdAt)}</span>
          </div>
          <p className="mt-3 break-all text-sm text-muted-foreground">
            {artifact.value ?? artifact.url ?? "No value"}
          </p>
          {artifact.url ? (
            <Button asChild className="mt-3" type="button" variant="outline">
              <a href={artifact.url} rel="noreferrer" target="_blank">
                Open artifact
              </a>
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RunEventPanel({ events }: { events: RunEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
        No lifecycle events have been attached to this run yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div className="rounded-2xl border border-border/60 bg-background/90 p-4" key={event.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium">{event.eventKind}</p>
              <p className="text-sm text-muted-foreground">{event.message}</p>
            </div>
            <StatusPill tone={runTone(event.level)}>{event.level}</StatusPill>
          </div>
          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
            {event.stepKey ? <p>Step: {event.stepKey}</p> : null}
            {Object.entries(event.metadata).map(([key, value]) => (
              <p key={`${event.id}-${key}`}>
                {key}: {value}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{formatDate(event.createdAt)}</p>
        </div>
      ))}
    </div>
  );
}

function LabeledField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function InlineNotice({ message, tone }: { message: string; tone: "danger" | "success" }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "danger" && "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-100",
        tone === "success" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
      )}
    >
      {message}
    </div>
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

const inputClassName =
  "h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20";
