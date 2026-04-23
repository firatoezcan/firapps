import { useLiveQuery, type Collection } from "@tanstack/react-db";
import { useCallback, useEffect, useState } from "react";

import {
  type ActivityItem,
  type Blueprint,
  type LoadStatus,
  type Overview,
  type Project,
  type PullRequestRecord,
  type RunnerRecord,
  type RunnerRegistrationInput,
  type RunnerRegistrationResult,
  type RunRecord,
  type Workspace,
  normalizeActivity,
  normalizeBlueprints,
  normalizeOverview,
  normalizeProjects,
  normalizePullRequests,
  normalizeRunner,
  normalizeRunners,
  normalizeRun,
  normalizeRuns,
  normalizeWorkspaces,
  requestInternalApi,
  toErrorMessage,
} from "./control-plane";
import { createHttpSnapshotCollection } from "./http-snapshot-collection";

export type UsageProject = {
  activeSeats: number;
  billingEmail?: string | null;
  billingPlan?: string | null;
  billingReference?: string | null;
  billingStatus?: string | null;
  completedRuns: number;
  computeMinutes: number;
  id: string;
  lastRunAt?: string | null;
  name: string;
  openPullRequests: number;
  readyWorkspaces: number;
  runCount: number;
  seatLimit?: number | null;
  slug: string;
};

export type UsageSummary = {
  activeSeats: number;
  computeMinutes: number;
  openPullRequests: number;
  readyWorkspaces: number;
  runCount: number;
  seatLimit: number;
};

export type OperatorService = {
  detail: string;
  name: string;
  status: string;
};

export type OperatorOrganization = {
  activeRuns: number;
  failedRuns: number;
  id: string;
  memberCount: number;
  name: string;
  pendingInvitations: number;
  projectCount: number;
  readyWorkspaces: number;
  slug: string;
};

export type OperatorQueueItem = {
  id: string;
  projectId: string;
  source: string;
  status: string;
  title: string;
  updatedAt?: string | null;
};

export type OperatorActivity = {
  description: string;
  id: string;
  kind: string;
  occurredAt?: string | null;
  organizationId?: string | null;
  runId?: string | null;
  status: string;
  tenantId?: string | null;
  title: string;
  workspaceRecordId?: string | null;
};

export type OperatorFailure = {
  failureMessage?: string | null;
  id: string;
  title: string;
  updatedAt?: string | null;
};

export type OperatorSummary = {
  failedRuns: number;
  organizations: number;
  projects: number;
  readyWorkspaces: number;
  runs: number;
};

export type OperatorRuntimeNode = {
  name: string;
  ready: boolean;
  schedulable: boolean;
  workspaceIdeReady: boolean;
};

export type OperatorRuntimeWorkspaceFailure = {
  failureMessage?: string | null;
  failureReason?: string | null;
  phase?: string | null;
  workspaceId: string;
};

export type OperatorRuntimeWorkspaceSummary = {
  failed: number;
  provisioning: number;
  ready: number;
  readyWorkspaceIdeNodes: number;
  total: number;
  workspaceIdeReadyNodes: number;
};

export type OperatorRuntimeSnapshot = {
  failedWorkspaces: OperatorRuntimeWorkspaceFailure[];
  generatedAt?: string | null;
  nodes: OperatorRuntimeNode[];
  services: OperatorService[];
  workspaceSummary: OperatorRuntimeWorkspaceSummary;
};

export type OperatorSnapshot = {
  generatedAt?: string | null;
  organizations: OperatorOrganization[];
  queue: OperatorQueueItem[];
  recentActivity: OperatorActivity[];
  recentFailures: OperatorFailure[];
  runtime: OperatorRuntimeSnapshot | null;
  services: OperatorService[];
  summary: OperatorSummary;
};

export type WorkspaceRow = Workspace & {
  projectName: string;
  projectSlug: string;
};

type OverviewRow = Overview & { id: "overview" };
type UsageSummaryRow = UsageSummary & { id: "usage-summary" };
type OperatorSnapshotRow = OperatorSnapshot & { id: "operator-snapshot" };

const emptyOverview: Overview = {
  activeRuns: 0,
  failedRuns: 0,
  pendingInvitations: 0,
  projectCount: 0,
  readyWorkspaces: 0,
  runCount: 0,
  workspaceCount: 0,
};

export const emptyUsageSummary: UsageSummary = {
  activeSeats: 0,
  computeMinutes: 0,
  openPullRequests: 0,
  readyWorkspaces: 0,
  runCount: 0,
  seatLimit: 0,
};

export const emptyOperatorSnapshot: OperatorSnapshot = {
  generatedAt: null,
  organizations: [],
  queue: [],
  recentActivity: [],
  recentFailures: [],
  runtime: null,
  services: [],
  summary: {
    failedRuns: 0,
    organizations: 0,
    projects: 0,
    readyWorkspaces: 0,
    runs: 0,
  },
};

const adminProjects = createHttpSnapshotCollection<Project, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-projects",
});
const adminBlueprints = createHttpSnapshotCollection<Blueprint, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-blueprints",
});
const adminOverview = createHttpSnapshotCollection<OverviewRow, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-overview",
});
const adminActivity = createHttpSnapshotCollection<ActivityItem, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-activity",
});
const adminDeployments = createHttpSnapshotCollection<AdminDeployment, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-deployments",
});
const adminWorkspaces = createHttpSnapshotCollection<WorkspaceRow, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-workspaces",
});
const adminUsageProjects = createHttpSnapshotCollection<UsageProject, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-usage-projects",
});
const adminUsageSummary = createHttpSnapshotCollection<UsageSummaryRow, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-usage-summary",
});
const adminPullRequests = createHttpSnapshotCollection<PullRequestRecord, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-pull-requests",
});
const adminRuns = createHttpSnapshotCollection<RunRecord, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-runs",
});
const adminRunDetails = createHttpSnapshotCollection<RunRecord, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-run-details",
});
const adminRunners = createHttpSnapshotCollection<RunnerRecord, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-runners",
});
const adminOperatorSnapshot = createHttpSnapshotCollection<OperatorSnapshotRow, string>({
  getKey: (row) => row.id,
  id: "admin-product-http-operator-snapshot",
});

export type AdminDeployment = {
  id: string;
  tenantId: string;
  environment: string;
  version: string;
  status: string;
  updatedAt?: string | null;
};

type CollectionRows<T> = {
  error: string | null;
  refresh: () => Promise<T[]>;
  rows: T[];
  status: LoadStatus;
};

function useCollectionRows<T extends object>({
  collection,
  enabled,
  errorMessage,
  refreshCollection,
}: {
  collection: Collection<T, string>;
  enabled: boolean;
  errorMessage: string;
  refreshCollection: () => Promise<T[]>;
}): CollectionRows<T> {
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const liveRows = useLiveQuery((query) => (enabled ? query.from({ row: collection }) : undefined));

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const rows = await refreshCollection();
      setStatus("ready");
      return rows;
    } catch (caughtError) {
      setStatus("error");
      setError(toErrorMessage(caughtError, errorMessage));
      return [];
    }
  }, [errorMessage, refreshCollection]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setError(null);
      return;
    }

    void refresh();
  }, [enabled, refresh]);

  return {
    error,
    refresh,
    rows: enabled ? (liveRows.data ?? []) : [],
    status,
  };
}

export function useAdminProjects(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminProjectsCollection(), [scopeKey]);

  return useCollectionRows({
    collection: adminProjects.collection,
    enabled,
    errorMessage: "Unable to load project inventory.",
    refreshCollection,
  });
}

export function useAdminBlueprints(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminBlueprintsCollection(), [scopeKey]);

  return useCollectionRows({
    collection: adminBlueprints.collection,
    enabled,
    errorMessage: "Unable to load blueprint inventory.",
    refreshCollection,
  });
}

export function useAdminOverview(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminOverviewCollection(), [scopeKey]);
  const result = useCollectionRows({
    collection: adminOverview.collection,
    enabled,
    errorMessage: "Unable to load overview.",
    refreshCollection,
  });

  return {
    ...result,
    overview: stripOverviewRow(result.rows[0]) ?? emptyOverview,
  };
}

export function useAdminActivity(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminActivityCollection(), [scopeKey]);

  return useCollectionRows({
    collection: adminActivity.collection,
    enabled,
    errorMessage: "Unable to load recent activity.",
    refreshCollection,
  });
}

export function useAdminDeployments(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminDeploymentsCollection(), [scopeKey]);

  return useCollectionRows({
    collection: adminDeployments.collection,
    enabled,
    errorMessage: "Unable to load deployments.",
    refreshCollection,
  });
}

export function useAdminWorkspacesForProject(
  enabled: boolean,
  project: Project | null | undefined,
) {
  const refreshCollection = useCallback(
    () => refreshAdminWorkspacesCollection(project ? [project] : []),
    [project],
  );

  return useCollectionRows({
    collection: adminWorkspaces.collection,
    enabled,
    errorMessage: "Unable to load workspace inventory.",
    refreshCollection,
  });
}

export function useAdminWorkspaceInventory(
  enabled: boolean,
  projects: Project[],
  scopeKey: string | null | undefined,
) {
  const refreshCollection = useCallback(
    () => refreshAdminWorkspacesCollection(projects),
    [projects, scopeKey],
  );

  return useCollectionRows({
    collection: adminWorkspaces.collection,
    enabled,
    errorMessage: "Unable to load devbox inventory.",
    refreshCollection,
  });
}

export function useAdminUsage(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshProjectsCollection = useCallback(
    () => refreshAdminUsageProjectsCollection(),
    [scopeKey],
  );
  const refreshSummaryCollection = useCallback(
    () => refreshAdminUsageSummaryCollection(),
    [scopeKey],
  );
  const projectsResult = useCollectionRows({
    collection: adminUsageProjects.collection,
    enabled,
    errorMessage: "Unable to load usage projects.",
    refreshCollection: refreshProjectsCollection,
  });
  const summaryResult = useCollectionRows({
    collection: adminUsageSummary.collection,
    enabled,
    errorMessage: "Unable to load usage summary.",
    refreshCollection: refreshSummaryCollection,
  });

  return {
    error: projectsResult.error ?? summaryResult.error,
    projects: projectsResult.rows,
    refresh: async () => {
      await Promise.all([projectsResult.refresh(), summaryResult.refresh()]);
    },
    status: resolveCombinedStatus(projectsResult.status, summaryResult.status),
    summary: stripUsageSummaryRow(summaryResult.rows[0]) ?? emptyUsageSummary,
  };
}

export function useAdminPullRequests(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminPullRequestsCollection(), [scopeKey]);

  return useCollectionRows({
    collection: adminPullRequests.collection,
    enabled,
    errorMessage: "Unable to load pull request inventory.",
    refreshCollection,
  });
}

export function useAdminRuns(
  enabled: boolean,
  scopeKey: string | null | undefined,
  projectId?: string,
) {
  const refreshCollection = useCallback(
    () => refreshAdminRunsCollection(projectId),
    [projectId, scopeKey],
  );

  return useCollectionRows({
    collection: adminRuns.collection,
    enabled,
    errorMessage: "Unable to load runs.",
    refreshCollection,
  });
}

export function useAdminRunDetail(
  enabled: boolean,
  scopeKey: string | null | undefined,
  runId: string | null | undefined,
) {
  const refreshCollection = useCallback(async () => {
    if (!runId) {
      await adminRunDetails.replaceRows([]);
      return [];
    }

    const run = await refreshAdminRunDetailCollection(runId);
    return run ? [run] : [];
  }, [runId, scopeKey]);
  const result = useCollectionRows({
    collection: adminRunDetails.collection,
    enabled: enabled && Boolean(runId),
    errorMessage: "Unable to load run detail.",
    refreshCollection,
  });

  return {
    ...result,
    run: result.rows.find((row) => row.id === runId) ?? null,
  };
}

export function useAdminRunners(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminRunnersCollection(), [scopeKey]);

  return useCollectionRows({
    collection: adminRunners.collection,
    enabled,
    errorMessage: "Unable to load runners.",
    refreshCollection,
  });
}

export function useAdminOperatorSnapshot(enabled: boolean, scopeKey: string | null | undefined) {
  const refreshCollection = useCallback(() => refreshAdminOperatorSnapshotCollection(), [scopeKey]);
  const result = useCollectionRows({
    collection: adminOperatorSnapshot.collection,
    enabled,
    errorMessage: "Unable to load founder operator state.",
    refreshCollection,
  });

  return {
    ...result,
    snapshot: stripOperatorSnapshotRow(result.rows[0]) ?? emptyOperatorSnapshot,
  };
}

export async function refreshAdminProjectsCollection() {
  const payload = (await requestInternalApi("/projects")) as { projects?: unknown[] } | null;
  const rows = normalizeProjects(payload?.projects);

  await adminProjects.replaceRows(rows);
  return rows;
}

export async function refreshAdminBlueprintsCollection() {
  const payload = (await requestInternalApi("/blueprints")) as { blueprints?: unknown[] } | null;
  const rows = normalizeBlueprints(payload?.blueprints);

  await adminBlueprints.replaceRows(rows);
  return rows;
}

export async function refreshAdminOverviewCollection() {
  const payload = (await requestInternalApi("/overview")) as { overview?: unknown } | null;
  const row: OverviewRow = { ...normalizeOverview(payload?.overview), id: "overview" };

  await adminOverview.replaceRows([row]);
  return [row];
}

export async function refreshAdminActivityCollection() {
  const payload = (await requestInternalApi("/activity")) as { activity?: unknown[] } | null;
  const rows = normalizeActivity(payload?.activity);

  await adminActivity.replaceRows(rows);
  return rows;
}

export async function refreshAdminDeploymentsCollection() {
  const payload = (await requestInternalApi("/deployments")) as { deployments?: unknown[] } | null;
  const rows = normalizeDeployments(payload?.deployments);

  await adminDeployments.replaceRows(rows);
  return rows;
}

export async function refreshAdminWorkspacesCollection(projects: Project[]) {
  if (projects.length === 0) {
    await adminWorkspaces.replaceRows([]);
    return [];
  }

  const workspacePayloads = await Promise.all(
    projects.map(async (project) => {
      const payload = (await requestInternalApi(
        `/workspaces?tenantId=${encodeURIComponent(project.id)}`,
      )) as { workspaces?: unknown[] } | null;

      return normalizeWorkspaces(payload?.workspaces).map((workspace) => ({
        ...workspace,
        projectName: project.name,
        projectSlug: project.slug,
      }));
    }),
  );
  const rows = workspacePayloads
    .flat()
    .sort(
      (left, right) =>
        new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() -
        new Date(left.updatedAt ?? left.createdAt ?? 0).getTime(),
    );

  await adminWorkspaces.replaceRows(rows);
  return rows;
}

export async function refreshAdminUsageCollections() {
  const payload = (await requestInternalApi("/usage")) as {
    projects?: unknown[];
    summary?: unknown;
  } | null;
  const projects = normalizeUsageProjects(payload?.projects);
  const summary: UsageSummaryRow = {
    ...normalizeUsageSummary(payload?.summary),
    id: "usage-summary",
  };

  await Promise.all([
    adminUsageProjects.replaceRows(projects),
    adminUsageSummary.replaceRows([summary]),
  ]);
  return { projects, summary };
}

export async function refreshAdminUsageProjectsCollection() {
  const result = await refreshAdminUsageCollections();
  return result.projects;
}

export async function refreshAdminUsageSummaryCollection() {
  const result = await refreshAdminUsageCollections();
  return [result.summary];
}

export async function refreshAdminPullRequestsCollection() {
  const payload = (await requestInternalApi("/pull-requests")) as {
    pullRequests?: unknown[];
  } | null;
  const rows = normalizePullRequests(payload?.pullRequests);

  await adminPullRequests.replaceRows(rows);
  return rows;
}

export async function refreshAdminRunsCollection(projectId?: string) {
  const searchParams = new URLSearchParams();

  if (projectId) {
    searchParams.set("tenantId", projectId);
  }

  const payload = (await requestInternalApi(
    `/runs${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
  )) as { runs?: unknown[] } | null;
  const rows = normalizeRuns(payload?.runs);

  await adminRuns.replaceRows(rows);
  return rows;
}

export async function refreshAdminRunDetailCollection(runId: string) {
  const payload = (await requestInternalApi(`/runs/${encodeURIComponent(runId)}`)) as {
    run?: unknown;
  } | null;
  const run = payload?.run ? normalizeRun(payload.run) : null;

  await adminRunDetails.replaceRows(run ? [run] : []);
  return run;
}

export async function refreshAdminRunnersCollection() {
  const payload = (await requestInternalApi("/runners")) as { runners?: unknown[] } | null;
  const rows = normalizeRunners(payload?.runners);

  await adminRunners.replaceRows(rows);
  return rows;
}

export async function refreshAdminOperatorSnapshotCollection() {
  const payload = (await requestInternalApi("/operator")) as unknown;
  const row: OperatorSnapshotRow = {
    ...normalizeOperatorSnapshot(payload),
    id: "operator-snapshot",
  };

  await adminOperatorSnapshot.replaceRows([row]);
  return [row];
}

export async function createAdminProject(input: Record<string, unknown>) {
  await requestInternalApi("/projects", {
    body: JSON.stringify(input),
    method: "POST",
  });

  await Promise.all([refreshAdminProjectsCollection(), refreshAdminOverviewCollection()]);
}

export async function updateAdminProject(projectId: string, input: Record<string, unknown>) {
  await requestInternalApi(`/projects/${encodeURIComponent(projectId)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });

  await Promise.all([
    refreshAdminProjectsCollection(),
    refreshAdminOverviewCollection(),
    refreshAdminUsageCollections(),
  ]);
}

export async function deleteAdminProject(projectId: string) {
  await requestInternalApi(`/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });

  await Promise.all([refreshAdminProjectsCollection(), refreshAdminOverviewCollection()]);
}

export async function createAdminBlueprint(input: Record<string, unknown>) {
  const payload = (await requestInternalApi("/blueprints", {
    body: JSON.stringify(input),
    method: "POST",
  })) as { blueprint?: unknown } | null;
  const created = normalizeBlueprints(payload?.blueprint ? [payload.blueprint] : [])[0] ?? null;

  await refreshAdminBlueprintsCollection();
  return created;
}

export async function updateAdminBlueprint(blueprintId: string, input: Record<string, unknown>) {
  const payload = (await requestInternalApi(`/blueprints/${encodeURIComponent(blueprintId)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  })) as { blueprint?: unknown } | null;
  const updated = normalizeBlueprints(payload?.blueprint ? [payload.blueprint] : [])[0] ?? null;

  await refreshAdminBlueprintsCollection();
  return updated;
}

export async function deleteAdminBlueprint(blueprintId: string) {
  await requestInternalApi(`/blueprints/${encodeURIComponent(blueprintId)}`, {
    method: "DELETE",
  });

  await Promise.all([refreshAdminBlueprintsCollection(), refreshAdminProjectsCollection()]);
}

export async function createAdminWorkspace(input: Record<string, unknown>, projects: Project[]) {
  await requestInternalApi("/workspaces", {
    body: JSON.stringify(input),
    method: "POST",
  });

  await Promise.all([refreshAdminWorkspacesCollection(projects), refreshAdminOverviewCollection()]);
}

export async function deleteAdminWorkspace(workspaceId: string, projects: Project[]) {
  await requestInternalApi(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
  });

  await Promise.all([refreshAdminWorkspacesCollection(projects), refreshAdminOverviewCollection()]);
}

export async function createAdminRun(input: Record<string, unknown>, projectId?: string) {
  const payload = (await requestInternalApi("/runs", {
    body: JSON.stringify(input),
    method: "POST",
  })) as { run?: unknown } | null;
  const run = payload?.run ? normalizeRun(payload.run) : null;

  await Promise.all([
    refreshAdminRunsCollection(projectId),
    refreshAdminOverviewCollection(),
    refreshAdminActivityCollection(),
  ]);

  if (run) {
    await adminRunDetails.replaceRows([run]);
  }

  return run;
}

export async function createAdminSidechannelDispatch(
  input: {
    blueprintSlug: string;
    channelName: string;
    objective: string;
    organizationSlug: string;
    projectSlug: string;
    requestedByName: string;
    title: string;
    userId: string;
    webhookSecret: string;
  },
  projectId?: string,
) {
  const payload = (await requestSlackStyleSidechannelDispatch(input)) as { run?: unknown } | null;
  const run = payload?.run ? normalizeRun(payload.run) : null;

  await Promise.all([
    refreshAdminRunsCollection(projectId),
    refreshAdminOverviewCollection(),
    refreshAdminActivityCollection(),
  ]);

  if (run) {
    await adminRunDetails.replaceRows([run]);
  }

  return run;
}

export async function retryAdminRun(runId: string, projectId?: string) {
  const payload = (await requestInternalApi(`/runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
  })) as { run?: unknown } | null;
  const run = payload?.run ? normalizeRun(payload.run) : null;

  await Promise.all([
    refreshAdminRunsCollection(projectId),
    refreshAdminOverviewCollection(),
    refreshAdminActivityCollection(),
    refreshAdminPullRequestsCollection(),
  ]);

  if (run) {
    await adminRunDetails.replaceRows([run]);
  }

  return run;
}

export async function createAdminRunnerRegistration(input: RunnerRegistrationInput) {
  const payload = (await requestInternalApi("/runners", {
    body: JSON.stringify(input),
    method: "POST",
  })) as {
    apiKey?: unknown;
    controlPlaneUrl?: unknown;
    control_plane_url?: unknown;
    imageRef?: unknown;
    image_ref?: unknown;
    installCommand?: unknown;
    install_command?: unknown;
    runner?: unknown;
  } | null;

  const result = {
    apiKey: typeof payload?.apiKey === "string" ? payload.apiKey : null,
    controlPlaneUrl:
      typeof payload?.controlPlaneUrl === "string"
        ? payload.controlPlaneUrl
        : typeof payload?.control_plane_url === "string"
          ? payload.control_plane_url
          : null,
    imageRef:
      typeof payload?.imageRef === "string"
        ? payload.imageRef
        : typeof payload?.image_ref === "string"
          ? payload.image_ref
          : null,
    installCommand:
      typeof payload?.installCommand === "string"
        ? payload.installCommand
        : typeof payload?.install_command === "string"
          ? payload.install_command
          : null,
    runner: normalizeRunner(payload?.runner, 0),
  } satisfies RunnerRegistrationResult;

  await refreshAdminRunnersCollection();
  return result;
}

export async function revokeAdminRunner(runnerId: string) {
  const payload = (await requestInternalApi(`/runners/${encodeURIComponent(runnerId)}/revoke`, {
    method: "POST",
  })) as { runner?: unknown } | null;
  const runner = normalizeRunner(payload?.runner, 0);

  await refreshAdminRunnersCollection();
  return runner;
}

function resolveCombinedStatus(left: LoadStatus, right: LoadStatus): LoadStatus {
  if (left === "error" || right === "error") {
    return "error";
  }

  if (left === "loading" || right === "loading") {
    return "loading";
  }

  if (left === "ready" && right === "ready") {
    return "ready";
  }

  return "idle";
}

function stripOverviewRow(row: OverviewRow | undefined): Overview | null {
  if (!row) {
    return null;
  }

  const { id: _id, ...overview } = row;
  return overview;
}

function stripUsageSummaryRow(row: UsageSummaryRow | undefined): UsageSummary | null {
  if (!row) {
    return null;
  }

  const { id: _id, ...summary } = row;
  return summary;
}

function stripOperatorSnapshotRow(row: OperatorSnapshotRow | undefined): OperatorSnapshot | null {
  if (!row) {
    return null;
  }

  const { id: _id, ...snapshot } = row;
  return snapshot;
}

async function requestSlackStyleSidechannelDispatch({
  blueprintSlug,
  channelName,
  objective,
  organizationSlug,
  projectSlug,
  requestedByName,
  title,
  userId,
  webhookSecret,
}: {
  blueprintSlug: string;
  channelName: string;
  objective: string;
  organizationSlug: string;
  projectSlug: string;
  requestedByName: string;
  title: string;
  userId: string;
  webhookSecret: string;
}) {
  const responseUrl =
    typeof window !== "undefined"
      ? new URL("/hooks/slack/mock", window.location.origin).toString()
      : "/hooks/slack/mock";
  const response = await fetch("/api/internal/dispatch/slack", {
    body: new URLSearchParams({
      channel_id: "CDEVBOXES",
      channel_name: channelName,
      command: "/dispatch",
      response_url: responseUrl,
      team_domain: "firapps-local",
      team_id: "TLOCAL",
      text: [
        `organization=${organizationSlug}`,
        `project=${projectSlug}`,
        `blueprint=${blueprintSlug}`,
        `title=${title}`,
        `objective=${objective}`,
      ].join(";"),
      trigger_id: `trigger-${Date.now()}`,
      user_id: userId,
      user_name: requestedByName,
    }),
    credentials: "include",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-firapps-dispatch-secret": webhookSecret,
    },
    method: "POST",
  });

  if (response.status === 401) {
    throw new Error("Internal API rejected the current Better Auth session.");
  }

  if (response.status === 403) {
    throw new Error("Internal API denied access for the current session.");
  }

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

async function readApiError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { error?: string; message?: string };
      const detail = payload.message ?? payload.error ?? JSON.stringify(payload);

      return `Internal API returned ${response.status}: ${detail}`;
    }

    const detail = (await response.text()).trim();

    return detail
      ? `Internal API returned ${response.status}: ${detail}`
      : `Internal API returned ${response.status}.`;
  } catch {
    return `Internal API returned ${response.status}.`;
  }
}

function normalizeDeployments(entries: unknown): AdminDeployment[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => ({
    environment: readString(entry, "environment") ?? "unknown",
    id: readString(entry, "id") ?? `deployment-${index}`,
    status: readString(entry, "status") ?? "unknown",
    tenantId: readString(entry, "tenantId") ?? readString(entry, "tenant_id") ?? "",
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
    version: readString(entry, "version") ?? "unknown",
  }));
}

function normalizeUsageProjects(entries: unknown): UsageProject[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => ({
    activeSeats: readNumber(entry, "activeSeats") ?? 0,
    billingEmail: readString(entry, "billingEmail") ?? readString(entry, "billing_email") ?? null,
    billingPlan: readString(entry, "billingPlan") ?? readString(entry, "billing_plan") ?? null,
    billingReference:
      readString(entry, "billingReference") ?? readString(entry, "billing_reference") ?? null,
    billingStatus:
      readString(entry, "billingStatus") ?? readString(entry, "billing_status") ?? null,
    completedRuns: readNumber(entry, "completedRuns") ?? readNumber(entry, "completed_runs") ?? 0,
    computeMinutes:
      readNumber(entry, "computeMinutes") ?? readNumber(entry, "compute_minutes") ?? 0,
    id: readString(entry, "id") ?? `usage-project-${index}`,
    lastRunAt: readString(entry, "lastRunAt") ?? readString(entry, "last_run_at") ?? null,
    name: readString(entry, "name") ?? `Project ${index + 1}`,
    openPullRequests:
      readNumber(entry, "openPullRequests") ?? readNumber(entry, "open_pull_requests") ?? 0,
    readyWorkspaces:
      readNumber(entry, "readyWorkspaces") ?? readNumber(entry, "ready_workspaces") ?? 0,
    runCount: readNumber(entry, "runCount") ?? readNumber(entry, "run_count") ?? 0,
    seatLimit: readNumber(entry, "seatLimit") ?? readNumber(entry, "seat_limit") ?? null,
    slug: readString(entry, "slug") ?? `project-${index + 1}`,
  }));
}

function normalizeUsageSummary(entry: unknown): UsageSummary {
  return {
    activeSeats: readNumber(entry, "activeSeats") ?? 0,
    computeMinutes:
      readNumber(entry, "computeMinutes") ?? readNumber(entry, "compute_minutes") ?? 0,
    openPullRequests:
      readNumber(entry, "openPullRequests") ?? readNumber(entry, "open_pull_requests") ?? 0,
    readyWorkspaces:
      readNumber(entry, "readyWorkspaces") ?? readNumber(entry, "ready_workspaces") ?? 0,
    runCount: readNumber(entry, "runCount") ?? readNumber(entry, "run_count") ?? 0,
    seatLimit: readNumber(entry, "seatLimit") ?? readNumber(entry, "seat_limit") ?? 0,
  };
}

function normalizeOperatorSnapshot(entry: unknown): OperatorSnapshot {
  return {
    generatedAt: readString(entry, "generatedAt") ?? readString(entry, "generated_at") ?? null,
    organizations: normalizeOperatorOrganizations(readArray(entry, "organizations")),
    queue: normalizeQueueItems(readArray(entry, "queue")),
    recentActivity: normalizeRecentActivity(readArray(entry, "recentActivity")),
    recentFailures: normalizeRecentFailures(readArray(entry, "recentFailures")),
    runtime: normalizeRuntimeSnapshot(readObject(entry, "runtime")),
    services: normalizeServices(readArray(entry, "services")),
    summary: normalizeSummary(readObject(entry, "summary")),
  };
}

function normalizeRuntimeSnapshot(
  entry: Record<string, unknown> | null,
): OperatorRuntimeSnapshot | null {
  if (!entry) {
    return null;
  }

  return {
    failedWorkspaces: normalizeFailedWorkspaces(readArray(entry, "failedWorkspaces")),
    generatedAt: readString(entry, "generatedAt") ?? readString(entry, "generated_at") ?? null,
    nodes: normalizeRuntimeNodes(readArray(entry, "nodes")),
    services: normalizeServices(readArray(entry, "services")),
    workspaceSummary: normalizeRuntimeWorkspaceSummary(readObject(entry, "workspaceSummary")),
  };
}

function normalizeServices(entries: unknown[] | null): OperatorService[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    detail: readString(entry, "detail") ?? "",
    name: readString(entry, "name") ?? `service-${index}`,
    status: readString(entry, "status") ?? "unknown",
  }));
}

function normalizeOperatorOrganizations(entries: unknown[] | null): OperatorOrganization[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    activeRuns: readNumber(entry, "activeRuns") ?? readNumber(entry, "active_runs") ?? 0,
    failedRuns: readNumber(entry, "failedRuns") ?? readNumber(entry, "failed_runs") ?? 0,
    id: readString(entry, "id") ?? `org-${index}`,
    memberCount: readNumber(entry, "memberCount") ?? readNumber(entry, "member_count") ?? 0,
    name: readString(entry, "name") ?? `Organization ${index + 1}`,
    pendingInvitations:
      readNumber(entry, "pendingInvitations") ?? readNumber(entry, "pending_invitations") ?? 0,
    projectCount: readNumber(entry, "projectCount") ?? readNumber(entry, "project_count") ?? 0,
    readyWorkspaces:
      readNumber(entry, "readyWorkspaces") ?? readNumber(entry, "ready_workspaces") ?? 0,
    slug: readString(entry, "slug") ?? `organization-${index + 1}`,
  }));
}

function normalizeQueueItems(entries: unknown[] | null): OperatorQueueItem[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    id: readString(entry, "id") ?? `queue-${index}`,
    projectId: readString(entry, "projectId") ?? readString(entry, "project_id") ?? "unknown",
    source: readString(entry, "source") ?? "manual",
    status: readString(entry, "status") ?? "unknown",
    title: readString(entry, "title") ?? `Queue item ${index + 1}`,
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  }));
}

function normalizeRecentActivity(entries: unknown[] | null): OperatorActivity[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    description: readString(entry, "description") ?? "",
    id: readString(entry, "id") ?? `activity-${index}`,
    kind: readString(entry, "kind") ?? "event",
    occurredAt: readString(entry, "occurredAt") ?? readString(entry, "occurred_at") ?? null,
    organizationId:
      readString(entry, "organizationId") ?? readString(entry, "organization_id") ?? null,
    runId: readString(entry, "runId") ?? readString(entry, "run_id") ?? null,
    status: readString(entry, "status") ?? "completed",
    tenantId: readString(entry, "tenantId") ?? readString(entry, "tenant_id") ?? null,
    title: readString(entry, "title") ?? `Activity ${index + 1}`,
    workspaceRecordId:
      readString(entry, "workspaceRecordId") ?? readString(entry, "workspace_record_id") ?? null,
  }));
}

function normalizeRecentFailures(entries: unknown[] | null): OperatorFailure[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    failureMessage:
      readString(entry, "failureMessage") ?? readString(entry, "failure_message") ?? null,
    id: readString(entry, "id") ?? `failure-${index}`,
    title: readString(entry, "title") ?? `Failure ${index + 1}`,
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  }));
}

function normalizeRuntimeNodes(entries: unknown[] | null): OperatorRuntimeNode[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    name: readString(entry, "name") ?? `node-${index}`,
    ready: readBoolean(entry, "ready") ?? false,
    schedulable: readBoolean(entry, "schedulable") ?? false,
    workspaceIdeReady:
      readBoolean(entry, "workspaceIdeReady") ?? readBoolean(entry, "workspace_ide_ready") ?? false,
  }));
}

function normalizeFailedWorkspaces(entries: unknown[] | null): OperatorRuntimeWorkspaceFailure[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    failureMessage:
      readString(entry, "failureMessage") ?? readString(entry, "failure_message") ?? null,
    failureReason:
      readString(entry, "failureReason") ?? readString(entry, "failure_reason") ?? null,
    phase: readString(entry, "phase") ?? null,
    workspaceId:
      readString(entry, "workspaceId") ?? readString(entry, "workspace_id") ?? `workspace-${index}`,
  }));
}

function normalizeRuntimeWorkspaceSummary(
  entry: Record<string, unknown> | null,
): OperatorRuntimeWorkspaceSummary {
  return {
    failed: readNumber(entry, "failed") ?? 0,
    provisioning: readNumber(entry, "provisioning") ?? 0,
    ready: readNumber(entry, "ready") ?? 0,
    readyWorkspaceIdeNodes:
      readNumber(entry, "readyWorkspaceIdeNodes") ??
      readNumber(entry, "ready_workspace_ide_nodes") ??
      0,
    total: readNumber(entry, "total") ?? 0,
    workspaceIdeReadyNodes:
      readNumber(entry, "workspaceIdeReadyNodes") ??
      readNumber(entry, "workspace_ide_ready_nodes") ??
      0,
  };
}

function normalizeSummary(entry: unknown): OperatorSummary {
  return {
    failedRuns: readNumber(entry, "failedRuns") ?? readNumber(entry, "failed_runs") ?? 0,
    organizations: readNumber(entry, "organizations") ?? 0,
    projects: readNumber(entry, "projects") ?? 0,
    readyWorkspaces:
      readNumber(entry, "readyWorkspaces") ?? readNumber(entry, "ready_workspaces") ?? 0,
    runs: readNumber(entry, "runs") ?? 0,
  };
}

function readString(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function readNumber(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readBoolean(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "boolean" ? candidate : null;
}

function readArray(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return Array.isArray(candidate) ? candidate : null;
}

function readObject(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown>)
    : null;
}
