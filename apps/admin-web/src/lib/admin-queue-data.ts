import { electricCollectionOptions } from "@tanstack/electric-db-collection";
import {
  createCollection,
  useLiveQuery,
  type Collection,
  type SyncConfig,
} from "@tanstack/react-db";
import { useEffect, useMemo, useState } from "react";

import {
  type ActivityItem,
  type DispatchRecord,
  type LoadStatus,
  type Overview,
  type RunRecord,
  type RunStepCounts,
  type Workspace,
  normalizeActivity,
  normalizeOverview,
  normalizeRuns,
  requestInternalApi,
  toErrorMessage,
} from "./control-plane";

export type RuntimeCapacity = {
  capacityStatus: string;
  detail: string;
  executingRuns: number;
  failedWorkspaces: number;
  operatorStatus: string;
  provisioningWorkspaces: number;
  readyNodes: number;
  readyWorkspaces: number;
  totalNodes: number;
  totalWorkspaces: number;
  waitingRuns: number;
};

type QueueMetrics = {
  electricEnabled: boolean;
  generatedAt: string | null;
  overview: Overview;
  runtimeCapacity: RuntimeCapacity;
};

type QueueSnapshot = QueueMetrics & {
  activity: ActivityItem[];
  runs: RunRecord[];
};

type QueueDataSource = "electric" | "http";

type QueueRunRow = {
  id: string;
  organization_id: string;
  tenant_id: string;
  blueprint_id: string | null;
  requested_by_user_id: string;
  workspace_record_id: string | null;
  source: string;
  title: string;
  objective: string;
  status: string;
  branch_name: string | null;
  pr_url: string | null;
  result_summary: string | null;
  failure_message: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type QueueDispatchRow = {
  id: string;
  organization_id: string;
  tenant_id: string;
  blueprint_id: string | null;
  run_id: string | null;
  source: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  created_at: string;
  updated_at: string;
};

type QueueProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
};

type QueueBlueprintRow = {
  id: string;
  organization_id: string | null;
  name: string;
};

type QueueWorkspaceRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  provider: string;
  repo_provider: string;
  repo_owner: string;
  repo_name: string;
  image_flavor: string;
  nix_packages: string[];
  status: string;
  ide_url: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
};

type QueueRunStepRow = {
  id: string;
  run_id: string;
  status: string;
};

type QueueActivityRow = {
  id: string;
  organization_id: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  occurred_at: string;
};

const emptyRuntimeCapacity: RuntimeCapacity = {
  capacityStatus: "unknown",
  detail: "Provisioner runtime capacity is not available.",
  executingRuns: 0,
  failedWorkspaces: 0,
  operatorStatus: "unknown",
  provisioningWorkspaces: 0,
  readyNodes: 0,
  readyWorkspaces: 0,
  totalNodes: 0,
  totalWorkspaces: 0,
  waitingRuns: 0,
};

function queueShapeUrl(path: string) {
  const origin =
    typeof window === "undefined"
      ? (process.env.ADMIN_WEB_URL ?? "http://127.0.0.1:3001")
      : window.location.origin;

  return new URL(path, origin).toString();
}

const queueRunsCollection = createCollection(
  electricCollectionOptions<QueueRunRow>({
    getKey: (row) => row.id,
    id: "admin-queue-electric-runs",
    shapeOptions: {
      url: queueShapeUrl("/api/internal/electric/queue/runs"),
    },
  }),
);

const queueDispatchesCollection = createCollection(
  electricCollectionOptions<QueueDispatchRow>({
    getKey: (row) => row.id,
    id: "admin-queue-electric-dispatches",
    shapeOptions: {
      url: queueShapeUrl("/api/internal/electric/queue/dispatches"),
    },
  }),
);

const queueProjectsCollection = createCollection(
  electricCollectionOptions<QueueProjectRow>({
    getKey: (row) => row.id,
    id: "admin-queue-electric-projects",
    shapeOptions: {
      url: queueShapeUrl("/api/internal/electric/queue/projects"),
    },
  }),
);

const queueBlueprintsCollection = createCollection(
  electricCollectionOptions<QueueBlueprintRow>({
    getKey: (row) => row.id,
    id: "admin-queue-electric-blueprints",
    shapeOptions: {
      url: queueShapeUrl("/api/internal/electric/queue/blueprints"),
    },
  }),
);

const queueWorkspacesCollection = createCollection(
  electricCollectionOptions<QueueWorkspaceRow>({
    getKey: (row) => row.id,
    id: "admin-queue-electric-workspaces",
    shapeOptions: {
      url: queueShapeUrl("/api/internal/electric/queue/workspaces"),
    },
  }),
);

const queueRunStepsCollection = createCollection(
  electricCollectionOptions<QueueRunStepRow>({
    getKey: (row) => row.id,
    id: "admin-queue-electric-run-steps",
    shapeOptions: {
      url: queueShapeUrl("/api/internal/electric/queue/run-steps"),
    },
  }),
);

const queueActivityCollection = createCollection(
  electricCollectionOptions<QueueActivityRow>({
    getKey: (row) => row.id,
    id: "admin-queue-electric-activity",
    shapeOptions: {
      url: queueShapeUrl("/api/internal/electric/queue/activity"),
    },
  }),
);

type HttpSnapshotCollection<T extends object, TKey extends string | number> = {
  collection: Collection<T, TKey>;
  replaceRows: (rows: T[]) => Promise<void>;
};

function createHttpSnapshotCollection<T extends object, TKey extends string | number>({
  getKey,
  id,
}: {
  getKey: (row: T) => TKey;
  id: string;
}): HttpSnapshotCollection<T, TKey> {
  type SyncParams = Parameters<SyncConfig<T, TKey>["sync"]>[0];

  let syncParams: SyncParams | null = null;
  const collection = createCollection<T, TKey>({
    getKey,
    id,
    sync: {
      sync: (params) => {
        syncParams = params;
        params.markReady();

        return () => {
          syncParams = null;
        };
      },
    },
  });

  return {
    collection,
    replaceRows: async (rows) => {
      await collection.preload();

      if (!syncParams) {
        throw new Error(`HTTP snapshot collection ${id} is not ready.`);
      }

      syncParams.begin({ immediate: true });
      syncParams.truncate();
      for (const row of rows) {
        syncParams.write({
          type: "insert",
          value: row,
        });
      }
      syncParams.commit();
    },
  };
}

const queueHttpRuns = createHttpSnapshotCollection<RunRecord, string>({
  getKey: (row) => row.id,
  id: "admin-queue-http-runs",
});

const queueHttpActivity = createHttpSnapshotCollection<ActivityItem, string>({
  getKey: (row) => row.id,
  id: "admin-queue-http-activity",
});

const queueCollections = [
  queueRunsCollection,
  queueDispatchesCollection,
  queueProjectsCollection,
  queueBlueprintsCollection,
  queueWorkspacesCollection,
  queueRunStepsCollection,
  queueActivityCollection,
] as const;

const queueHttpCollections = [queueHttpRuns.collection, queueHttpActivity.collection] as const;

export async function fetchQueueMetrics() {
  const payload = (await requestInternalApi("/queue/metrics")) as {
    electricEnabled?: unknown;
    generatedAt?: unknown;
    overview?: unknown;
    runtimeCapacity?: unknown;
  } | null;

  return {
    electricEnabled: readBoolean(payload, "electricEnabled") ?? false,
    generatedAt: readString(payload, "generatedAt") ?? null,
    overview: normalizeOverview(payload?.overview),
    runtimeCapacity: normalizeRuntimeCapacity(payload?.runtimeCapacity),
  } satisfies QueueMetrics;
}

export async function fetchQueueSnapshot() {
  const payload = (await requestInternalApi("/queue")) as {
    activity?: unknown;
    generatedAt?: unknown;
    overview?: unknown;
    runtimeCapacity?: unknown;
    runs?: unknown;
  } | null;

  return {
    activity: normalizeActivity(payload?.activity),
    electricEnabled: false,
    generatedAt: readString(payload, "generatedAt") ?? null,
    overview: normalizeOverview(payload?.overview),
    runtimeCapacity: normalizeRuntimeCapacity(payload?.runtimeCapacity),
    runs: normalizeRuns(payload?.runs),
  } satisfies QueueSnapshot;
}

export async function preloadAdminQueueCollections() {
  await Promise.all(queueCollections.map((collection) => collection.preload()));
}

export async function preloadAdminQueueHttpCollections() {
  await Promise.all(queueHttpCollections.map((collection) => collection.preload()));
}

export async function replaceAdminQueueHttpSnapshot(
  snapshot: Pick<QueueSnapshot, "activity" | "runs">,
) {
  await Promise.all([
    queueHttpRuns.replaceRows(snapshot.runs),
    queueHttpActivity.replaceRows(snapshot.activity),
  ]);
}

export async function clearAdminQueueHttpSnapshot() {
  await replaceAdminQueueHttpSnapshot({
    activity: [],
    runs: [],
  });
}

export function useAdminQueueLiveSlice(enabled: boolean, source: QueueDataSource) {
  const [preloadError, setPreloadError] = useState<string | null>(null);
  const electricEnabled = enabled && source === "electric";
  const httpEnabled = enabled && source === "http";

  useEffect(() => {
    if (!electricEnabled) {
      setPreloadError(null);
      return;
    }

    let cancelled = false;
    setPreloadError(null);

    void preloadAdminQueueCollections().catch((caughtError) => {
      if (!cancelled) {
        setPreloadError(toErrorMessage(caughtError, "Unable to start Electric queue sync."));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [electricEnabled]);

  const runsResult = useLiveQuery((query) =>
    electricEnabled ? query.from({ run: queueRunsCollection }) : undefined,
  );
  const dispatchesResult = useLiveQuery((query) =>
    electricEnabled ? query.from({ dispatch: queueDispatchesCollection }) : undefined,
  );
  const projectsResult = useLiveQuery((query) =>
    electricEnabled ? query.from({ project: queueProjectsCollection }) : undefined,
  );
  const blueprintsResult = useLiveQuery((query) =>
    electricEnabled ? query.from({ blueprint: queueBlueprintsCollection }) : undefined,
  );
  const workspacesResult = useLiveQuery((query) =>
    electricEnabled ? query.from({ workspace: queueWorkspacesCollection }) : undefined,
  );
  const runStepsResult = useLiveQuery((query) =>
    electricEnabled ? query.from({ step: queueRunStepsCollection }) : undefined,
  );
  const activityResult = useLiveQuery((query) =>
    electricEnabled ? query.from({ activity: queueActivityCollection }) : undefined,
  );
  const httpRunsResult = useLiveQuery((query) =>
    httpEnabled ? query.from({ run: queueHttpRuns.collection }) : undefined,
  );
  const httpActivityResult = useLiveQuery((query) =>
    httpEnabled ? query.from({ activity: queueHttpActivity.collection }) : undefined,
  );

  const status =
    source === "electric"
      ? resolveLiveStatus(electricEnabled, [
          runsResult.status,
          dispatchesResult.status,
          projectsResult.status,
          blueprintsResult.status,
          workspacesResult.status,
          runStepsResult.status,
          activityResult.status,
        ])
      : resolveLiveStatus(httpEnabled, [httpRunsResult.status, httpActivityResult.status]);
  const error =
    source === "electric"
      ? (preloadError ??
        (status === "error" ? "Electric queue sync entered an error state." : null))
      : status === "error"
        ? "HTTP queue snapshot cache entered an error state."
        : null;

  const runs = useMemo(() => {
    if (source === "http") {
      return httpRunsResult.data ?? [];
    }

    return buildRunRecords({
      blueprints: blueprintsResult.data ?? [],
      dispatches: dispatchesResult.data ?? [],
      projects: projectsResult.data ?? [],
      runs: runsResult.data ?? [],
      runSteps: runStepsResult.data ?? [],
      workspaces: workspacesResult.data ?? [],
    });
  }, [
    blueprintsResult.data,
    dispatchesResult.data,
    httpRunsResult.data,
    projectsResult.data,
    runsResult.data,
    runStepsResult.data,
    source,
    workspacesResult.data,
  ]);
  const activity = useMemo(
    () =>
      source === "http"
        ? (httpActivityResult.data ?? [])
        : buildActivityItems(activityResult.data ?? []),
    [activityResult.data, httpActivityResult.data, source],
  );

  return {
    activity,
    error,
    runs,
    status,
  } satisfies {
    activity: ActivityItem[];
    error: string | null;
    runs: RunRecord[];
    status: LoadStatus;
  };
}

function buildActivityItems(rows: QueueActivityRow[]): ActivityItem[] {
  return [...rows]
    .sort((left, right) => compareTimestamps(right.occurred_at, left.occurred_at))
    .map((row) => ({
      description: row.description,
      id: row.id,
      kind: row.kind,
      occurredAt: row.occurred_at,
      status: row.status,
      title: row.title,
    }));
}

function buildRunRecords(input: {
  blueprints: QueueBlueprintRow[];
  dispatches: QueueDispatchRow[];
  projects: QueueProjectRow[];
  runs: QueueRunRow[];
  runSteps: QueueRunStepRow[];
  workspaces: QueueWorkspaceRow[];
}): RunRecord[] {
  const dispatchByRunId = new Map(
    input.dispatches
      .filter((dispatch) => dispatch.run_id)
      .map((dispatch) => [dispatch.run_id as string, dispatch]),
  );
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const blueprintById = new Map(input.blueprints.map((blueprint) => [blueprint.id, blueprint]));
  const workspaceById = new Map(input.workspaces.map((workspace) => [workspace.id, workspace]));
  const stepCountsByRunId = buildRunStepCounts(input.runSteps);

  return [...input.runs]
    .sort((left, right) => compareTimestamps(right.created_at, left.created_at))
    .map((run) => {
      const dispatch = dispatchByRunId.get(run.id) ?? null;
      const project = projectById.get(run.tenant_id) ?? null;
      const blueprint = run.blueprint_id ? (blueprintById.get(run.blueprint_id) ?? null) : null;
      const workspace =
        run.workspace_record_id != null
          ? (workspaceById.get(run.workspace_record_id) ?? null)
          : null;

      return {
        blueprintId: run.blueprint_id,
        blueprintName: blueprint?.name ?? null,
        branchName: run.branch_name,
        completedAt: run.completed_at,
        createdAt: run.created_at,
        dispatch: dispatch ? toDispatchRecord(dispatch, run) : null,
        events: [],
        failureMessage: run.failure_message,
        id: run.id,
        objective: run.objective,
        prUrl: run.pr_url,
        projectName: project?.name ?? null,
        projectSlug: project?.slug ?? null,
        queuedAt: run.queued_at,
        requestedBy: null,
        resultSummary: run.result_summary,
        source: run.source,
        startedAt: run.started_at,
        status: run.status,
        stepCounts: stepCountsByRunId.get(run.id) ?? emptyRunStepCounts(),
        steps: [],
        tenantId: run.tenant_id,
        title: run.title,
        updatedAt: run.updated_at,
        workspace: workspace ? toWorkspace(workspace) : null,
      } satisfies RunRecord;
    });
}

function buildRunStepCounts(rows: QueueRunStepRow[]) {
  const counts = new Map<string, RunStepCounts>();

  for (const row of rows) {
    const current = counts.get(row.run_id) ?? emptyRunStepCounts();

    current.total += 1;
    if (row.status === "completed") {
      current.completed += 1;
    } else if (row.status === "failed") {
      current.failed += 1;
    } else if (row.status === "in_progress" || row.status === "provisioning") {
      current.inProgress += 1;
    } else {
      current.queued += 1;
    }

    counts.set(row.run_id, current);
  }

  return counts;
}

function compareTimestamps(left: string | null | undefined, right: string | null | undefined) {
  return toTimestamp(left) - toTimestamp(right);
}

function emptyRunStepCounts(): RunStepCounts {
  return {
    completed: 0,
    failed: 0,
    inProgress: 0,
    queued: 0,
    total: 0,
  };
}

function normalizeRuntimeCapacity(entry: unknown): RuntimeCapacity {
  if (!entry || typeof entry !== "object") {
    return emptyRuntimeCapacity;
  }

  const value = entry as Record<string, unknown>;

  return {
    capacityStatus: readString(value, "capacityStatus") ?? "unknown",
    detail: readString(value, "detail") ?? "Provisioner runtime capacity is not available.",
    executingRuns: readNumber(value, "executingRuns") ?? 0,
    failedWorkspaces: readNumber(value, "failedWorkspaces") ?? 0,
    operatorStatus: readString(value, "operatorStatus") ?? "unknown",
    provisioningWorkspaces: readNumber(value, "provisioningWorkspaces") ?? 0,
    readyNodes: readNumber(value, "readyNodes") ?? 0,
    readyWorkspaces: readNumber(value, "readyWorkspaces") ?? 0,
    totalNodes: readNumber(value, "totalNodes") ?? 0,
    totalWorkspaces: readNumber(value, "totalWorkspaces") ?? 0,
    waitingRuns: readNumber(value, "waitingRuns") ?? 0,
  };
}

function readBoolean(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "boolean" ? candidate : null;
}

function readNumber(entry: Record<string, unknown>, key: string) {
  const candidate = entry[key];

  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readString(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function resolveLiveStatus(enabled: boolean, statuses: string[]): LoadStatus {
  if (!enabled) {
    return "idle";
  }

  if (statuses.some((status) => status === "error")) {
    return "error";
  }

  if (statuses.every((status) => status === "ready")) {
    return "ready";
  }

  if (statuses.some((status) => status === "loading")) {
    return "loading";
  }

  return "idle";
}

function toDispatchRecord(dispatch: QueueDispatchRow, run: QueueRunRow): DispatchRecord {
  return {
    createdAt: dispatch.created_at,
    id: dispatch.id,
    objective: run.objective,
    requestedBy: null,
    requestedByEmail: dispatch.requested_by_email,
    requestedByName: dispatch.requested_by_name,
    source: dispatch.source,
    title: run.title,
    updatedAt: dispatch.updated_at,
  };
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function toWorkspace(row: QueueWorkspaceRow): Workspace {
  return {
    createdAt: row.created_at,
    id: row.workspace_id,
    ideUrl: row.ide_url,
    imageFlavor: row.image_flavor,
    name: null,
    nixPackages: row.nix_packages,
    previewUrl: row.preview_url,
    provider: row.provider,
    repoName: row.repo_name,
    repoOwner: row.repo_owner,
    repoProvider: row.repo_provider,
    status: row.status,
    tenantId: row.tenant_id,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id,
  };
}
