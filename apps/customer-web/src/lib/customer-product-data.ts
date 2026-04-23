import { createCollection, type Collection, type SyncConfig } from "@tanstack/react-db";
import { useEffect, useMemo, useState } from "react";

import {
  type ActivityItem,
  type LoadStatus,
  type Overview,
  type Project,
  type RunnerRecord,
  type RunRecord,
  type Workspace,
  normalizeActivity,
  normalizeOverview,
  normalizeProjects,
  normalizeRun,
  normalizeRunners,
  normalizeRuns,
  normalizeWorkspaces,
  requestInternalApi,
} from "./internal-control-plane";

export type Product = {
  featured: boolean;
  id: string;
  name: string;
  priceCents: number;
  slug: string;
  status: string;
};

export type Announcement = {
  body: string;
  id: string;
  title: string;
  tone: "danger" | "neutral" | "success" | "warning";
};

export type CustomerWorkspaceAccess = Workspace & {
  projectName: string;
  projectSlug: string;
};

const requestedByFilter = "self" as const;

export type MemberRunScope = {
  description: string;
  kind: "backend-filtered";
  label: string;
  requestedBy: typeof requestedByFilter;
};

export type MemberScopedRunsResult = {
  organizationRuns: RunRecord[];
  runs: RunRecord[];
  scope: MemberRunScope;
};

type SessionIdentity = {
  email?: string | null;
  userId: string;
};

type OverviewRow = Overview & {
  id: "customer-overview";
};

type HttpSnapshotCollection<T extends object, TKey extends string | number> = {
  clearRows: () => Promise<void>;
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

  async function replaceRows(rows: T[]) {
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
  }

  return {
    clearRows: () => replaceRows([]),
    collection,
    replaceRows,
  };
}

const customerProducts = createHttpSnapshotCollection<Product, string>({
  getKey: (row) => row.id,
  id: "customer-http-public-products",
});

const customerAnnouncements = createHttpSnapshotCollection<Announcement, string>({
  getKey: (row) => row.id,
  id: "customer-http-public-announcements",
});

const customerProjects = createHttpSnapshotCollection<Project, string>({
  getKey: (row) => row.id,
  id: "customer-http-projects",
});

const customerWorkspaces = createHttpSnapshotCollection<CustomerWorkspaceAccess, string>({
  getKey: (row) => row.id,
  id: "customer-http-workspaces",
});

const customerOverview = createHttpSnapshotCollection<OverviewRow, string>({
  getKey: (row) => row.id,
  id: "customer-http-overview",
});

const customerActivity = createHttpSnapshotCollection<ActivityItem, string>({
  getKey: (row) => row.id,
  id: "customer-http-activity",
});

const customerOrganizationRuns = createHttpSnapshotCollection<RunRecord, string>({
  getKey: (row) => row.id,
  id: "customer-http-organization-runs",
});

const customerMemberRuns = createHttpSnapshotCollection<RunRecord, string>({
  getKey: (row) => row.id,
  id: "customer-http-member-runs",
});

const customerRunDetails = createHttpSnapshotCollection<RunRecord, string>({
  getKey: (row) => row.id,
  id: "customer-http-run-details",
});

const customerRunners = createHttpSnapshotCollection<RunnerRecord, string>({
  getKey: (row) => row.id,
  id: "customer-http-runners",
});

export async function refreshCustomerPublicCatalogSnapshot() {
  const [productsPayload, announcementsPayload] = await Promise.all([
    requestPublicApi("/products"),
    requestPublicApi("/announcements"),
  ]);
  const products = normalizeProducts(readArray(productsPayload, "products"));
  const announcements = normalizeAnnouncements(readArray(announcementsPayload, "announcements"));

  await Promise.all([
    customerProducts.replaceRows(products),
    customerAnnouncements.replaceRows(announcements),
  ]);

  return {
    announcements,
    products,
  };
}

export async function clearCustomerPublicCatalogSnapshot() {
  await Promise.all([customerProducts.clearRows(), customerAnnouncements.clearRows()]);
}

export async function refreshCustomerProjectsSnapshot() {
  const payload = (await requestInternalApi("/projects")) as { projects?: unknown[] } | null;
  const projects = normalizeProjects(payload?.projects);

  await customerProjects.replaceRows(projects);

  return projects;
}

export async function clearCustomerProjectsSnapshot() {
  await customerProjects.clearRows();
}

export async function refreshCustomerWorkspacesSnapshot(projects: Project[]) {
  if (projects.length === 0) {
    await customerWorkspaces.clearRows();
    return [] satisfies CustomerWorkspaceAccess[];
  }

  const payloads = await Promise.all(
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
  const workspaces = payloads
    .flat()
    .sort(
      (left, right) =>
        toTimestamp(right.updatedAt ?? right.createdAt) -
        toTimestamp(left.updatedAt ?? left.createdAt),
    );

  await customerWorkspaces.replaceRows(workspaces);

  return workspaces;
}

export async function clearCustomerWorkspacesSnapshot() {
  await customerWorkspaces.clearRows();
}

export async function refreshCustomerOperationsSnapshot(identity: SessionIdentity) {
  const [overviewPayload, memberScopedRuns, activityPayload] = await Promise.all([
    requestInternalApi("/overview"),
    refreshCustomerMemberRunsSnapshot(identity),
    requestInternalApi("/activity"),
  ]);
  const overview = normalizeOverview((overviewPayload as { overview?: unknown } | null)?.overview);
  const activity = normalizeActivity(
    (activityPayload as { activity?: unknown[] } | null)?.activity,
  );

  await Promise.all([
    customerOverview.replaceRows([{ ...overview, id: "customer-overview" }]),
    customerActivity.replaceRows(activity),
  ]);

  return {
    activity,
    overview,
    ...memberScopedRuns,
  };
}

export async function clearCustomerOperationsSnapshot() {
  await Promise.all([
    customerOverview.clearRows(),
    customerActivity.clearRows(),
    customerOrganizationRuns.clearRows(),
    customerMemberRuns.clearRows(),
  ]);
}

export async function refreshCustomerMemberRunsSnapshot(
  identity: SessionIdentity,
): Promise<MemberScopedRunsResult> {
  const organizationRuns = await fetchRuns("/runs");
  const memberRuns = await fetchRuns(`/runs?requestedBy=${requestedByFilter}`);
  const organizationContainsKnownForeignRuns = organizationRuns.some((run) =>
    runHasKnownForeignRequestor(run, identity),
  );

  if (memberRuns.some((run) => runHasKnownForeignRequestor(run, identity))) {
    throw new Error(
      "The backend returned foreign runs for requestedBy=self, so the member-scoped run contract regressed.",
    );
  }

  const result = {
    organizationRuns,
    runs: memberRuns,
    scope: {
      description: organizationContainsKnownForeignRuns
        ? "Customer-web now relies on the explicit backend filter `requestedBy=self`, so this route only loads runs requested by your signed-in member even when the broader organization stream contains other members' work."
        : "Customer-web now relies on the explicit backend filter `requestedBy=self`, and the current organization sample also happens to contain only your runs.",
      kind: "backend-filtered",
      label: "Backend member scope",
      requestedBy: requestedByFilter,
    },
  } satisfies MemberScopedRunsResult;

  await Promise.all([
    customerOrganizationRuns.replaceRows(organizationRuns),
    customerMemberRuns.replaceRows(memberRuns),
  ]);

  return result;
}

export async function clearCustomerMemberRunsSnapshot() {
  await Promise.all([customerOrganizationRuns.clearRows(), customerMemberRuns.clearRows()]);
}

export async function refreshCustomerRunDetailSnapshot(runId: string, identity: SessionIdentity) {
  const memberRunsResult = await refreshCustomerMemberRunsSnapshot(identity);
  const visibleRun = memberRunsResult.runs.find((candidate) => candidate.id === runId);

  if (!visibleRun) {
    throw new Error("This run is not visible for the current member session.");
  }

  const payload = (await requestInternalApi(`/runs/${encodeURIComponent(runId)}`)) as {
    run?: unknown;
  } | null;
  const detail = payload?.run ? normalizeRun(payload.run) : null;

  if (!detail) {
    throw new Error("The selected run detail payload was empty.");
  }

  await customerRunDetails.replaceRows([detail]);

  return {
    run: detail,
    scope: memberRunsResult.scope,
  };
}

export async function clearCustomerRunDetailSnapshot() {
  await customerRunDetails.clearRows();
}

export async function refreshCustomerRunnersSnapshot() {
  const payload = (await requestInternalApi("/runners")) as { runners?: unknown[] } | null;
  const runners = normalizeRunners(payload?.runners);

  await customerRunners.replaceRows(runners);

  return runners;
}

export async function clearCustomerRunnersSnapshot() {
  await customerRunners.clearRows();
}

export function useCustomerPublicCatalogCollection(enabled = true) {
  usePreloadCollections(enabled, [customerProducts.collection, customerAnnouncements.collection]);

  const productsResult = useCollectionSnapshot(customerProducts.collection, enabled);
  const announcementsResult = useCollectionSnapshot(customerAnnouncements.collection, enabled);

  return {
    announcements: announcementsResult.rows,
    products: productsResult.rows,
    status: resolveLiveStatus(enabled, [productsResult.status, announcementsResult.status]),
  };
}

export function useCustomerProjectsCollection(enabled: boolean) {
  usePreloadCollections(enabled, [customerProjects.collection]);

  const projectsResult = useCollectionSnapshot(customerProjects.collection, enabled);

  return {
    projects: projectsResult.rows,
    status: resolveLiveStatus(enabled, [projectsResult.status]),
  };
}

export function useCustomerWorkspacesCollection(enabled: boolean) {
  usePreloadCollections(enabled, [customerWorkspaces.collection]);

  const workspacesResult = useCollectionSnapshot(customerWorkspaces.collection, enabled);

  return {
    status: resolveLiveStatus(enabled, [workspacesResult.status]),
    workspaces: workspacesResult.rows,
  };
}

export function useCustomerOperationsCollection(enabled: boolean) {
  usePreloadCollections(enabled, [
    customerOverview.collection,
    customerActivity.collection,
    customerOrganizationRuns.collection,
    customerMemberRuns.collection,
  ]);

  const overviewResult = useCollectionSnapshot(customerOverview.collection, enabled);
  const activityResult = useCollectionSnapshot(customerActivity.collection, enabled);
  const organizationRunsResult = useCollectionSnapshot(
    customerOrganizationRuns.collection,
    enabled,
  );
  const memberRunsResult = useCollectionSnapshot(customerMemberRuns.collection, enabled);
  const overview = useMemo(() => stripOverviewRow(overviewResult.rows[0]), [overviewResult.rows]);

  return {
    activity: activityResult.rows,
    organizationRuns: organizationRunsResult.rows,
    overview,
    runs: memberRunsResult.rows,
    status: resolveLiveStatus(enabled, [
      overviewResult.status,
      activityResult.status,
      organizationRunsResult.status,
      memberRunsResult.status,
    ]),
  };
}

export function useCustomerMemberRunsCollection(enabled: boolean) {
  usePreloadCollections(enabled, [
    customerOrganizationRuns.collection,
    customerMemberRuns.collection,
  ]);

  const organizationRunsResult = useCollectionSnapshot(
    customerOrganizationRuns.collection,
    enabled,
  );
  const memberRunsResult = useCollectionSnapshot(customerMemberRuns.collection, enabled);

  return {
    organizationRuns: organizationRunsResult.rows,
    runs: memberRunsResult.rows,
    status: resolveLiveStatus(enabled, [organizationRunsResult.status, memberRunsResult.status]),
  };
}

export function useCustomerRunDetailCollection(enabled: boolean, runId: string) {
  usePreloadCollections(enabled, [customerRunDetails.collection]);

  const runDetailResult = useCollectionSnapshot(customerRunDetails.collection, enabled);
  const run = useMemo(
    () => runDetailResult.rows.find((candidate) => candidate.id === runId) ?? null,
    [runDetailResult.rows, runId],
  );

  return {
    run,
    status: resolveLiveStatus(enabled, [runDetailResult.status]),
  };
}

export function useCustomerRunnersCollection(enabled: boolean) {
  usePreloadCollections(enabled, [customerRunners.collection]);

  const runnersResult = useCollectionSnapshot(customerRunners.collection, enabled);

  return {
    runners: runnersResult.rows,
    status: resolveLiveStatus(enabled, [runnersResult.status]),
  };
}

function useCollectionSnapshot<T extends object, TKey extends string | number>(
  collection: Collection<T, TKey>,
  enabled: boolean,
) {
  const [snapshot, setSnapshot] = useState<{ rows: T[]; status: string }>({
    rows: [],
    status: "idle",
  });

  useEffect(() => {
    if (!enabled) {
      setSnapshot({ rows: [], status: "idle" });
      return;
    }

    let cancelled = false;
    const refreshSnapshot = () => {
      if (!cancelled) {
        setSnapshot({
          rows: Array.from(collection.entries()).map(([, row]) => row),
          status: collection.status,
        });
      }
    };
    const subscription = collection.subscribeChanges(refreshSnapshot);

    refreshSnapshot();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [collection, enabled]);

  return snapshot;
}

function usePreloadCollections(
  enabled: boolean,
  collections: Array<{ preload: () => Promise<void> }>,
) {
  const [preloadError, setPreloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPreloadError(null);
      return;
    }

    let cancelled = false;

    setPreloadError(null);
    void Promise.all(collections.map((collection) => collection.preload())).catch((caughtError) => {
      if (!cancelled) {
        setPreloadError(toErrorMessage(caughtError, "Unable to start customer data collections."));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return preloadError;
}

async function requestPublicApi(path: string) {
  const response = await fetch(`/api/public${path}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Public API returned ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  return contentType.includes("application/json") ? response.json() : null;
}

async function fetchRuns(path: string) {
  const payload = (await requestInternalApi(path)) as {
    runs?: unknown[];
  } | null;

  return normalizeRuns(payload?.runs);
}

function runBelongsToMember(run: RunRecord, identity: SessionIdentity) {
  if (run.requestedBy?.id && run.requestedBy.id === identity.userId) {
    return true;
  }

  if (identity.email && run.requestedBy?.email) {
    return run.requestedBy.email.trim().toLowerCase() === identity.email.trim().toLowerCase();
  }

  return false;
}

function runHasKnownForeignRequestor(run: RunRecord, identity: SessionIdentity) {
  if (!run.requestedBy) {
    return false;
  }

  return !runBelongsToMember(run, identity);
}

function normalizeProducts(entries: unknown[] | null): Product[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => {
    const name = readString(entry, "name") ?? readString(entry, "slug") ?? `Product ${index + 1}`;

    return {
      featured: readBoolean(entry, "featured") ?? false,
      id: readString(entry, "id") ?? `product-${index}`,
      name,
      priceCents: readNumber(entry, "priceCents") ?? readNumber(entry, "price_cents") ?? 0,
      slug: readString(entry, "slug") ?? slugify(name),
      status: readString(entry, "status") ?? "unknown",
    };
  });
}

function normalizeAnnouncements(entries: unknown[] | null): Announcement[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    body: readString(entry, "body") ?? "",
    id: readString(entry, "id") ?? `announcement-${index}`,
    title: readString(entry, "title") ?? `Announcement ${index + 1}`,
    tone: normalizeAnnouncementTone(readString(entry, "tone")),
  }));
}

function normalizeAnnouncementTone(value: string | null): Announcement["tone"] {
  if (value === "danger" || value === "success" || value === "warning") {
    return value;
  }

  return "neutral";
}

function stripOverviewRow(row: OverviewRow | undefined): Overview {
  return {
    activeRuns: row?.activeRuns ?? 0,
    failedRuns: row?.failedRuns ?? 0,
    pendingInvitations: row?.pendingInvitations ?? 0,
    projectCount: row?.projectCount ?? 0,
    readyWorkspaces: row?.readyWorkspaces ?? 0,
    runCount: row?.runCount ?? 0,
    workspaceCount: row?.workspaceCount ?? 0,
  };
}

function resolveLiveStatus(enabled: boolean, statuses: string[]): LoadStatus {
  if (!enabled) {
    return "idle";
  }

  if (statuses.some((status) => status === "error")) {
    return "error";
  }

  if (statuses.some((status) => status === "loading" || status === "pending")) {
    return "loading";
  }

  return "ready";
}

function readArray(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return Array.isArray(candidate) ? candidate : null;
}

function readString(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function readNumber(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readBoolean(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return typeof candidate === "boolean" ? candidate : null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}
