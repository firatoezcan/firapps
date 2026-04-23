export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  description?: string | null;
  billingPlan?: string | null;
  defaultBranch?: string | null;
  lastRunAt?: string | null;
  repoName?: string | null;
  repoOwner?: string | null;
  repoProvider?: string | null;
  workspaceCount?: number | null;
};

export type Workspace = {
  id: string;
  workspaceId: string;
  tenantId: string;
  name?: string | null;
  repoOwner: string;
  repoName: string;
  repoProvider: string;
  provider: string;
  imageFlavor: string;
  nixPackages: string[];
  status: string;
  ideUrl?: string | null;
  previewUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type RunStepCounts = {
  completed: number;
  failed: number;
  inProgress: number;
  queued: number;
  total: number;
};

export type RunRequestedBy = {
  id: string;
  name: string;
  email: string;
};

export type RunArtifact = {
  id: string;
  artifactType: string;
  label: string;
  value?: string | null;
  url?: string | null;
  createdAt?: string | null;
};

export type RunStepRecord = {
  id: string;
  stepKey: string;
  label: string;
  stepKind: string;
  status: string;
  details?: string | null;
  position: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type RunEvent = {
  id: string;
  eventKind: string;
  level: string;
  message: string;
  metadata: Record<string, string>;
  stepKey?: string | null;
  createdAt?: string | null;
};

export type RunRecord = {
  id: string;
  tenantId: string;
  projectName?: string | null;
  projectSlug?: string | null;
  requestedBy?: RunRequestedBy | null;
  workspace?: Workspace | null;
  title: string;
  objective: string;
  source: string;
  status: string;
  branchName?: string | null;
  prUrl?: string | null;
  queuedAt?: string | null;
  resultSummary?: string | null;
  failureMessage?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  stepCounts: RunStepCounts;
  artifacts?: RunArtifact[];
  events?: RunEvent[];
  steps?: RunStepRecord[];
};

export type ActivityItem = {
  id: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  occurredAt?: string | null;
};

export type RunnerRecord = {
  allowedOperations: string[];
  apiKeyCreatedAt?: string | null;
  createdAt?: string | null;
  currentConcurrency?: number | null;
  displayName: string;
  hostLabel?: string | null;
  id: string;
  imageDigest?: string | null;
  imageVersion?: string | null;
  lastHeartbeatAt?: string | null;
  maxConcurrency: number;
  projectIds: string[];
  repositorySelectors: string[];
  revokedAt?: string | null;
  status: string;
  updatedAt?: string | null;
};

export type Overview = {
  activeRuns: number;
  failedRuns: number;
  pendingInvitations: number;
  projectCount: number;
  readyWorkspaces: number;
  runCount: number;
  workspaceCount: number;
};

const internalApiBasePath = "/api/internal";

export class InternalApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "InternalApiRequestError";
    this.status = status;
  }
}

export function isInternalApiRequestError(error: unknown): error is InternalApiRequestError {
  return error instanceof InternalApiRequestError;
}

export async function requestInternalApi(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${internalApiBasePath}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (response.status === 401) {
    throw new InternalApiRequestError(401, "Sign in again to load your workspace view.");
  }

  if (response.status === 403) {
    throw new InternalApiRequestError(
      403,
      "Your session can access the account but not this organization.",
    );
  }

  if (!response.ok) {
    throw new InternalApiRequestError(response.status, await readInternalApiError(response));
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

export async function listRunners() {
  const payload = (await requestInternalApi("/runners")) as { runners?: unknown[] } | null;

  return normalizeRunners(payload?.runners);
}

async function readInternalApiError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      const detail =
        readString(payload, "message") ?? readString(payload, "error") ?? JSON.stringify(payload);

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

export function normalizeProjects(entries: unknown): Project[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => {
    const name = readString(entry, "name") ?? readString(entry, "slug") ?? `Project ${index + 1}`;

    return {
      billingPlan:
        readString(entry, "billingPlan") ??
        readString(entry, "billing_plan") ??
        readString(entry, "plan") ??
        null,
      defaultBranch:
        readString(entry, "defaultBranch") ?? readString(entry, "default_branch") ?? null,
      description: readString(entry, "description") ?? null,
      id: readString(entry, "id") ?? `project-${index}`,
      lastRunAt: readString(entry, "lastRunAt") ?? readString(entry, "last_run_at") ?? null,
      name,
      repoName: readString(entry, "repoName") ?? readString(entry, "repo_name") ?? null,
      repoOwner: readString(entry, "repoOwner") ?? readString(entry, "repo_owner") ?? null,
      repoProvider: readString(entry, "repoProvider") ?? readString(entry, "repo_provider") ?? null,
      slug: readString(entry, "slug") ?? slugify(name),
      status: readString(entry, "status") ?? "unknown",
      workspaceCount:
        readNumber(entry, "workspaceCount") ?? readNumber(entry, "workspace_count") ?? null,
    };
  });
}

export function normalizeWorkspaces(entries: unknown): Workspace[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => {
    const repoOwner =
      readString(entry, "repoOwner") ?? readString(entry, "repositoryOwner") ?? "unknown-owner";
    const repoName =
      readString(entry, "repoName") ?? readString(entry, "repositoryName") ?? "unknown-repo";

    return {
      createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
      id: readString(entry, "id") ?? `workspace-${index}`,
      ideUrl:
        readString(entry, "ideUrl") ??
        readString(entry, "ideURL") ??
        readString(entry, "url") ??
        readString(entry, "accessUrl") ??
        readString(entry, "workspaceUrl") ??
        null,
      imageFlavor:
        readString(entry, "imageFlavor") ??
        readString(entry, "image_flavor") ??
        readString(entry, "image") ??
        "unknown-image",
      name: readString(entry, "name") ?? null,
      nixPackages:
        readStringArray(entry, "nixPackages") ?? readStringArray(entry, "nix_packages") ?? [],
      previewUrl:
        readString(entry, "previewUrl") ??
        readString(entry, "preview_url") ??
        readString(entry, "appUrl") ??
        null,
      provider: readString(entry, "provider") ?? "unknown-provider",
      repoName,
      repoOwner,
      repoProvider:
        readString(entry, "repoProvider") ?? readString(entry, "repo_provider") ?? "github",
      status: readString(entry, "status") ?? readString(entry, "state") ?? "unknown",
      tenantId: readString(entry, "tenantId") ?? readString(entry, "tenant_id") ?? "",
      updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
      workspaceId:
        readString(entry, "workspaceId") ??
        readString(entry, "workspace_id") ??
        `workspace-${index}`,
    };
  });
}

export function normalizeRuns(entries: unknown): RunRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => normalizeRun(entry, index));
}

export function normalizeRun(entry: unknown, index = 0): RunRecord {
  return {
    artifacts: normalizeArtifacts(readArray(entry, "artifacts")),
    branchName: readString(entry, "branchName") ?? readString(entry, "branch_name") ?? null,
    completedAt: readString(entry, "completedAt") ?? readString(entry, "completed_at") ?? null,
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    events: normalizeRunEvents(readArray(entry, "events")),
    failureMessage:
      readString(entry, "failureMessage") ?? readString(entry, "failure_message") ?? null,
    id: readString(entry, "id") ?? `run-${index}`,
    objective: readString(entry, "objective") ?? "",
    prUrl: readString(entry, "prUrl") ?? readString(entry, "pr_url") ?? null,
    projectName: readString(entry, "projectName") ?? readString(entry, "project_name") ?? null,
    projectSlug: readString(entry, "projectSlug") ?? readString(entry, "project_slug") ?? null,
    queuedAt: readString(entry, "queuedAt") ?? readString(entry, "queued_at") ?? null,
    requestedBy: normalizeRequestedBy(readObject(entry, "requestedBy")),
    resultSummary:
      readString(entry, "resultSummary") ?? readString(entry, "result_summary") ?? null,
    source: readString(entry, "source") ?? "manual",
    startedAt: readString(entry, "startedAt") ?? readString(entry, "started_at") ?? null,
    status: readString(entry, "status") ?? "queued",
    stepCounts: normalizeStepCounts(readObject(entry, "stepCounts")),
    steps: normalizeStepRecords(readArray(entry, "steps")),
    tenantId: readString(entry, "tenantId") ?? readString(entry, "tenant_id") ?? "",
    title: readString(entry, "title") ?? `Run ${index + 1}`,
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
    workspace: normalizeOptionalWorkspace(readObject(entry, "workspace")),
  };
}

export function normalizeActivity(entries: unknown): ActivityItem[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => ({
    description: readString(entry, "description") ?? "",
    id: readString(entry, "id") ?? `activity-${index}`,
    kind: readString(entry, "kind") ?? "event",
    occurredAt: readString(entry, "occurredAt") ?? readString(entry, "occurred_at") ?? null,
    status: readString(entry, "status") ?? "completed",
    title: readString(entry, "title") ?? `Activity ${index + 1}`,
  }));
}

export function normalizeRunners(entries: unknown): RunnerRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => normalizeRunner(entry, index))
    .filter((runner): runner is RunnerRecord => runner !== null);
}

export function normalizeRunner(entry: unknown, index = 0): RunnerRecord | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const displayName =
    readString(entry, "displayName") ??
    readString(entry, "display_name") ??
    readString(entry, "name") ??
    `Runner ${index + 1}`;

  return {
    allowedOperations:
      readStringArray(entry, "allowedOperations") ??
      readStringArray(entry, "allowed_operations") ??
      [],
    apiKeyCreatedAt:
      readString(entry, "apiKeyCreatedAt") ?? readString(entry, "api_key_created_at") ?? null,
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    currentConcurrency:
      readNumber(entry, "currentConcurrency") ?? readNumber(entry, "current_concurrency") ?? null,
    displayName,
    hostLabel: readString(entry, "hostLabel") ?? readString(entry, "host_label") ?? null,
    id: readString(entry, "id") ?? `runner-${index}`,
    imageDigest: readString(entry, "imageDigest") ?? readString(entry, "image_digest") ?? null,
    imageVersion: readString(entry, "imageVersion") ?? readString(entry, "image_version") ?? null,
    lastHeartbeatAt:
      readString(entry, "lastHeartbeatAt") ?? readString(entry, "last_heartbeat_at") ?? null,
    maxConcurrency:
      readNumber(entry, "maxConcurrency") ?? readNumber(entry, "max_concurrency") ?? 1,
    projectIds: readStringArray(entry, "projectIds") ?? readStringArray(entry, "project_ids") ?? [],
    repositorySelectors:
      readRepositorySelectors(readObject(entry, "repositoryScopes")) ??
      readRepositorySelectors(readObject(entry, "repository_scopes")) ??
      readStringArray(entry, "repositorySelectors") ??
      readStringArray(entry, "repository_selectors") ??
      [],
    revokedAt: readString(entry, "revokedAt") ?? readString(entry, "revoked_at") ?? null,
    status: readString(entry, "status") ?? "registered",
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  };
}

export function normalizeOverview(entry: unknown): Overview {
  return {
    activeRuns: readNumber(entry, "activeRuns") ?? readNumber(entry, "active_runs") ?? 0,
    failedRuns: readNumber(entry, "failedRuns") ?? readNumber(entry, "failed_runs") ?? 0,
    pendingInvitations:
      readNumber(entry, "pendingInvitations") ?? readNumber(entry, "pending_invitations") ?? 0,
    projectCount: readNumber(entry, "projectCount") ?? readNumber(entry, "project_count") ?? 0,
    readyWorkspaces:
      readNumber(entry, "readyWorkspaces") ?? readNumber(entry, "ready_workspaces") ?? 0,
    runCount: readNumber(entry, "runCount") ?? readNumber(entry, "run_count") ?? 0,
    workspaceCount:
      readNumber(entry, "workspaceCount") ?? readNumber(entry, "workspace_count") ?? 0,
  };
}

export function statusTone(status: LoadStatus): "danger" | "neutral" | "success" | "warning" {
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

export function runnerTone(
  status: string,
  revokedAt?: string | null,
): "danger" | "neutral" | "success" | "warning" {
  if (revokedAt) {
    return "danger";
  }

  switch (status.toLowerCase()) {
    case "online":
    case "active":
    case "ready":
    case "running":
      return "success";
    case "registered":
    case "pending":
    case "offline":
    case "stale":
      return "warning";
    case "revoked":
    case "failed":
    case "blocked":
      return "danger";
    default:
      return "neutral";
  }
}

export function formatRunnerStatus(status: string, revokedAt?: string | null) {
  if (revokedAt) {
    return "revoked";
  }

  return status.replace(/[_-]+/g, " ");
}

export function projectTone(status: string): "danger" | "neutral" | "success" | "warning" {
  const normalizedStatus = status.toLowerCase();

  if (["active", "healthy", "ready"].includes(normalizedStatus)) {
    return "success";
  }

  if (["pending", "provisioning", "trialing"].includes(normalizedStatus)) {
    return "warning";
  }

  if (["failed", "error", "degraded", "suspended"].includes(normalizedStatus)) {
    return "danger";
  }

  return "neutral";
}

export function runTone(status: string): "danger" | "neutral" | "success" | "warning" {
  const normalizedStatus = status.toLowerCase();

  if (["completed", "workspace_ready"].includes(normalizedStatus)) {
    return "success";
  }

  if (["queued", "provisioning", "in_progress", "blocked"].includes(normalizedStatus)) {
    return "warning";
  }

  if (["failed", "error"].includes(normalizedStatus)) {
    return "danger";
  }

  return "neutral";
}

export function workspaceTone(workspace: Workspace): "danger" | "neutral" | "success" | "warning" {
  if (workspaceIsReady(workspace)) {
    return "success";
  }

  const normalizedStatus = workspace.status.toLowerCase();

  if (["pending", "provisioning", "starting"].includes(normalizedStatus)) {
    return "warning";
  }

  if (["failed", "error", "deleted"].includes(normalizedStatus)) {
    return "danger";
  }

  return "neutral";
}

export function workspaceIsReady(workspace: Workspace) {
  if (workspace.ideUrl) {
    return true;
  }

  return ["active", "available", "ready", "running"].includes(workspace.status.toLowerCase());
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

export function getRunPullRequestUrl(run: RunRecord) {
  const directUrl = readTruthyString(run.prUrl);

  if (directUrl) {
    return directUrl;
  }

  const artifact = run.artifacts?.find((candidate) => {
    const artifactType = candidate.artifactType.toLowerCase();
    const label = candidate.label.toLowerCase();

    return artifactType.includes("pull_request") || label.includes("pull request");
  });

  return readTruthyString(artifact?.url) ?? readTruthyString(artifact?.value) ?? null;
}

export function getRunStep(run: RunRecord, stepKey: string) {
  return run.steps?.find((step) => step.stepKey === stepKey) ?? null;
}

export function getRunLastActivityAt(run: RunRecord) {
  return run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.queuedAt ?? run.createdAt ?? null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function readObject(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return typeof candidate === "object" && candidate !== null ? candidate : null;
}

function readArray(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return Array.isArray(candidate) ? candidate : null;
}

function readStringArray(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  if (Array.isArray(candidate)) {
    return candidate.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  }

  if (typeof candidate === "string") {
    return candidate
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return null;
}

function readRepositorySelectors(value: unknown) {
  return (
    readStringArray(value, "selectors") ??
    readStringArray(value, "repositories") ??
    readStringArray(value, "repositorySelectors") ??
    readStringArray(value, "repository_selectors")
  );
}

function normalizeRequestedBy(value: unknown): RunRequestedBy | null {
  const id = readString(value, "id");

  if (!id) {
    return null;
  }

  return {
    email: readString(value, "email") ?? "",
    id,
    name: readString(value, "name") ?? readString(value, "email") ?? "Unknown teammate",
  };
}

function normalizeArtifacts(entries: unknown[] | null): RunArtifact[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    artifactType:
      readString(entry, "artifactType") ?? readString(entry, "artifact_type") ?? "artifact",
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    id: readString(entry, "id") ?? `artifact-${index}`,
    label: readString(entry, "label") ?? `Artifact ${index + 1}`,
    url: readString(entry, "url"),
    value: readString(entry, "value"),
  }));
}

function normalizeStepRecords(entries: unknown[] | null): RunStepRecord[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    details: readString(entry, "details") ?? null,
    id: readString(entry, "id") ?? `step-${index}`,
    label: readString(entry, "label") ?? `Step ${index + 1}`,
    position: readNumber(entry, "position") ?? index,
    status: readString(entry, "status") ?? "unknown",
    stepKey: readString(entry, "stepKey") ?? readString(entry, "step_key") ?? `step-${index}`,
    stepKind: readString(entry, "stepKind") ?? readString(entry, "step_kind") ?? "deterministic",
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  }));
}

function normalizeRunEvents(entries: unknown[] | null): RunEvent[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    eventKind: readString(entry, "eventKind") ?? readString(entry, "event_kind") ?? "event",
    id: readString(entry, "id") ?? `run-event-${index}`,
    level: readString(entry, "level") ?? "info",
    message: readString(entry, "message") ?? "",
    metadata: readStringRecord(readObject(entry, "metadata")),
    stepKey: readString(entry, "stepKey") ?? readString(entry, "step_key") ?? null,
  }));
}

function normalizeStepCounts(value: unknown): RunStepCounts {
  return {
    completed: readNumber(value, "completed") ?? 0,
    failed: readNumber(value, "failed") ?? 0,
    inProgress: readNumber(value, "inProgress") ?? readNumber(value, "in_progress") ?? 0,
    queued: readNumber(value, "queued") ?? 0,
    total: readNumber(value, "total") ?? 0,
  };
}

function normalizeOptionalWorkspace(value: unknown): Workspace | null {
  if (!value) {
    return null;
  }

  return normalizeWorkspaces([value])[0] ?? null;
}

function readTruthyString(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) =>
      typeof entryValue === "string" && entryValue.trim().length > 0 ? [[key, entryValue]] : [],
    ),
  );
}
