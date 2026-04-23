export type LoadStatus = "idle" | "loading" | "ready" | "error" | "unauthorized";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
};

export type Deployment = {
  id: string;
  tenantId: string;
  environment: string;
  version: string;
  status: string;
  updatedAt?: string | null;
};

export type BlueprintStep = {
  key: string;
  kind: "agentic" | "deterministic";
  label: string;
};

export type DispatchReadinessStatus = "ready" | "blocked" | "attention" | "unknown";

export type DispatchReadinessChecks = {
  codexExecutionConfigured: boolean | null;
  githubTokenConfigured: boolean | null;
  platformProvisionerConfigured: boolean | null;
  repoConfigured: boolean | null;
  sandboxOperatorHealthy: boolean | null;
  sandboxWorkspaceApiHealthy: boolean | null;
};

export type DispatchReadiness = {
  checks: DispatchReadinessChecks;
  detail: string | null;
  dispatchReady: boolean;
  issues: string[];
  status: DispatchReadinessStatus;
};

export type Project = {
  billingStatus?: string | null;
  defaultBlueprintId?: string | null;
  id: string;
  name: string;
  slug: string;
  status: string;
  description?: string | null;
  billingEmail?: string | null;
  billingPlan?: string | null;
  billingReference?: string | null;
  defaultBranch?: string | null;
  lastRunAt?: string | null;
  repoName?: string | null;
  repoOwner?: string | null;
  repoProvider?: string | null;
  seatLimit?: number | null;
  workflowMode?: string | null;
  workspaceCount?: number | null;
  createdAt?: string | null;
  dispatchReadiness?: DispatchReadiness | null;
};

export type OrganizationTenant = Project;

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

export type Blueprint = {
  id: string;
  name: string;
  slug: string;
  description: string;
  scope: string;
  triggerSource: string;
  isActive: boolean;
  organizationId?: string | null;
  steps: BlueprintStep[];
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

export type DispatchRecord = {
  id: string;
  source: string;
  title: string;
  objective?: string | null;
  requestedBy?: RunRequestedBy | null;
  requestedByEmail?: string | null;
  requestedByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
  blueprintId?: string | null;
  blueprintName?: string | null;
  projectName?: string | null;
  projectSlug?: string | null;
  requestedBy?: RunRequestedBy | null;
  dispatch?: DispatchRecord | null;
  workspace?: Workspace | null;
  title: string;
  objective: string;
  source: string;
  status: string;
  branchName?: string | null;
  prUrl?: string | null;
  resultSummary?: string | null;
  failureMessage?: string | null;
  queuedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  stepCounts: RunStepCounts;
  steps?: RunStepRecord[];
  artifacts?: RunArtifact[];
  events?: RunEvent[];
};

export type QueueStage =
  | "queued"
  | "blocked"
  | "provisioning"
  | "active"
  | "completed"
  | "failed"
  | "other";

export type ActivityItem = {
  id: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  occurredAt?: string | null;
};

export type PullRequestRecord = {
  additions?: number | null;
  authorLogin?: string | null;
  baseBranch?: string | null;
  changedFiles?: number | null;
  checksStatus?: string | null;
  commitCount?: number | null;
  commentCount?: number | null;
  deletions?: number | null;
  githubLineChangeCount?: number | null;
  githubState?: string | null;
  githubUpdatedAt?: string | null;
  headBranch?: string | null;
  headSha?: string | null;
  id: string;
  isDraft?: boolean | null;
  labels?: string[];
  mergeable?: boolean | null;
  mergeableState?: string | null;
  metadataError?: string | null;
  prNumber?: number | null;
  prCreatedAt?: string | null;
  prTitle?: string | null;
  runId: string;
  repoName?: string | null;
  repoOwner?: string | null;
  requestedReviewerCount?: number | null;
  requestedReviewerLogins?: string[];
  title: string;
  prUrl: string;
  reviewCommentCount?: number | null;
  status: string;
  source: string;
  summary?: string | null;
  branchName?: string | null;
  projectName?: string | null;
  projectSlug?: string | null;
  requestedBy?: RunRequestedBy | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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

export type RunnerRegistrationInput = {
  allowedOperations: string[];
  displayName: string;
  maxConcurrency: number;
  repositoryScopes: Record<string, unknown>;
};

export type RunnerRegistrationResult = {
  apiKey: string | null;
  controlPlaneUrl: string | null;
  imageRef: string | null;
  installCommand: string | null;
  runner: RunnerRecord | null;
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
    throw new Error("Internal API rejected the current Better Auth session.");
  }

  if (response.status === 403) {
    throw new Error("Internal API denied access for the current session.");
  }

  if (!response.ok) {
    throw new Error(await readInternalApiError(response));
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

export async function createRunnerRegistration(input: RunnerRegistrationInput) {
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

  const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey : null;
  const controlPlaneUrl =
    typeof payload?.controlPlaneUrl === "string"
      ? payload.controlPlaneUrl
      : typeof payload?.control_plane_url === "string"
        ? payload.control_plane_url
        : null;
  const imageRef =
    typeof payload?.imageRef === "string"
      ? payload.imageRef
      : typeof payload?.image_ref === "string"
        ? payload.image_ref
        : null;
  const installCommand =
    typeof payload?.installCommand === "string"
      ? payload.installCommand
      : typeof payload?.install_command === "string"
        ? payload.install_command
        : null;

  return {
    apiKey,
    controlPlaneUrl,
    imageRef,
    installCommand,
    runner: normalizeRunner(payload?.runner, 0),
  } satisfies RunnerRegistrationResult;
}

export async function revokeRunner(runnerId: string) {
  const payload = (await requestInternalApi(`/runners/${encodeURIComponent(runnerId)}/revoke`, {
    method: "POST",
  })) as { runner?: unknown } | null;

  return normalizeRunner(payload?.runner, 0);
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

export function normalizeTenants(entries: unknown): Tenant[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => {
    const name = readString(entry, "name") ?? readString(entry, "slug") ?? `Tenant ${index + 1}`;

    return {
      id: readString(entry, "id") ?? `tenant-${index}`,
      name,
      plan:
        readString(entry, "plan") ??
        readString(entry, "billingPlan") ??
        readString(entry, "billing_plan") ??
        "growth",
      slug: readString(entry, "slug") ?? slugify(name),
      status: readString(entry, "status") ?? "unknown",
    };
  });
}

export function normalizeDeployments(entries: unknown): Deployment[] {
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

export function normalizeOrganizationTenants(entries: unknown): OrganizationTenant[] {
  return normalizeProjects(entries);
}

export function normalizeProjects(entries: unknown): Project[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => {
    const name = readString(entry, "name") ?? readString(entry, "slug") ?? `Tenant ${index + 1}`;

    return {
      billingEmail: readString(entry, "billingEmail") ?? readString(entry, "billing_email") ?? null,
      billingPlan:
        readString(entry, "billingPlan") ??
        readString(entry, "billing_plan") ??
        readString(entry, "plan") ??
        null,
      billingReference:
        readString(entry, "billingReference") ?? readString(entry, "billing_reference") ?? null,
      billingStatus:
        readString(entry, "billingStatus") ??
        readString(entry, "billing_status") ??
        readString(entry, "status") ??
        null,
      createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
      defaultBlueprintId:
        readString(entry, "defaultBlueprintId") ??
        readString(entry, "default_blueprint_id") ??
        null,
      defaultBranch:
        readString(entry, "defaultBranch") ?? readString(entry, "default_branch") ?? null,
      description: readString(entry, "description") ?? null,
      id: readString(entry, "id") ?? `org-tenant-${index}`,
      lastRunAt: readString(entry, "lastRunAt") ?? readString(entry, "last_run_at") ?? null,
      name,
      repoName: readString(entry, "repoName") ?? readString(entry, "repo_name") ?? null,
      repoOwner: readString(entry, "repoOwner") ?? readString(entry, "repo_owner") ?? null,
      repoProvider: readString(entry, "repoProvider") ?? readString(entry, "repo_provider") ?? null,
      seatLimit: readNumber(entry, "seatLimit") ?? readNumber(entry, "seat_limit") ?? null,
      slug: readString(entry, "slug") ?? slugify(name),
      status: readString(entry, "status") ?? "unknown",
      dispatchReadiness: normalizeDispatchReadiness(
        readObject(entry, "dispatchReadiness") ?? readObject(entry, "dispatch_readiness"),
      ),
      workflowMode: readString(entry, "workflowMode") ?? readString(entry, "workflow_mode") ?? null,
      workspaceCount:
        readNumber(entry, "workspaceCount") ?? readNumber(entry, "workspace_count") ?? null,
    };
  });
}

export function normalizeWorkspaces(entries: unknown): Workspace[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => normalizeWorkspace(entry, index));
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

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return "unknown";
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "unknown";
  }

  const diffMs = timestamp - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 45) {
    return diffSeconds >= 0 ? "in a few seconds" : "just now";
  }

  const ranges = [
    { unit: "minute", seconds: 60 },
    { unit: "hour", seconds: 60 * 60 },
    { unit: "day", seconds: 60 * 60 * 24 },
  ] as const;

  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];

    if (absSeconds >= range.seconds || range.unit === "minute") {
      return formatter.format(Math.round(diffSeconds / range.seconds), range.unit);
    }
  }

  return "unknown";
}

export function formatDateWithRelative(value: string | null | undefined) {
  const absolute = formatDate(value);
  const relative = formatRelativeTime(value);

  if (absolute === "unknown" || relative === "unknown") {
    return absolute;
  }

  return `${absolute} (${relative})`;
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

export function normalizeBlueprints(entries: unknown): Blueprint[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => ({
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    description: readString(entry, "description") ?? "",
    id: readString(entry, "id") ?? `blueprint-${index}`,
    isActive: readBoolean(entry, "isActive") ?? readBoolean(entry, "is_active") ?? true,
    name: readString(entry, "name") ?? `Blueprint ${index + 1}`,
    organizationId:
      readString(entry, "organizationId") ?? readString(entry, "organization_id") ?? null,
    scope: readString(entry, "scope") ?? "system",
    slug: readString(entry, "slug") ?? `blueprint-${index + 1}`,
    steps: normalizeBlueprintSteps(readArray(entry, "steps")),
    triggerSource:
      readString(entry, "triggerSource") ?? readString(entry, "trigger_source") ?? "manual",
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  }));
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
    blueprintId: readString(entry, "blueprintId") ?? readString(entry, "blueprint_id") ?? null,
    blueprintName:
      readString(entry, "blueprintName") ?? readString(entry, "blueprint_name") ?? null,
    branchName: readString(entry, "branchName") ?? readString(entry, "branch_name") ?? null,
    completedAt: readString(entry, "completedAt") ?? readString(entry, "completed_at") ?? null,
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    dispatch: normalizeOptionalDispatch(readObject(entry, "dispatch")),
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

export function normalizePullRequests(entries: unknown): PullRequestRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry, index) => ({
    additions: readNumber(entry, "additions") ?? null,
    authorLogin: readString(entry, "authorLogin") ?? readString(entry, "author_login") ?? null,
    baseBranch: readString(entry, "baseBranch") ?? readString(entry, "base_branch") ?? null,
    branchName: readString(entry, "branchName") ?? readString(entry, "branch_name") ?? null,
    changedFiles: readNumber(entry, "changedFiles") ?? readNumber(entry, "changed_files") ?? null,
    checksStatus: readString(entry, "checksStatus") ?? readString(entry, "checks_status") ?? null,
    commitCount: readNumber(entry, "commitCount") ?? readNumber(entry, "commit_count") ?? null,
    commentCount: readNumber(entry, "commentCount") ?? readNumber(entry, "comment_count") ?? null,
    completedAt: readString(entry, "completedAt") ?? readString(entry, "completed_at") ?? null,
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    deletions: readNumber(entry, "deletions") ?? null,
    githubLineChangeCount:
      readNumber(entry, "githubLineChangeCount") ??
      readNumber(entry, "github_line_change_count") ??
      null,
    githubState: readString(entry, "githubState") ?? readString(entry, "github_state") ?? null,
    githubUpdatedAt:
      readString(entry, "githubUpdatedAt") ?? readString(entry, "github_updated_at") ?? null,
    headBranch: readString(entry, "headBranch") ?? readString(entry, "head_branch") ?? null,
    headSha: readString(entry, "headSha") ?? readString(entry, "head_sha") ?? null,
    id: readString(entry, "id") ?? `pull-request-${index}`,
    isDraft: readBoolean(entry, "isDraft") ?? readBoolean(entry, "is_draft") ?? null,
    labels: readStringArray(entry, "labels") ?? [],
    mergeable: readBoolean(entry, "mergeable") ?? null,
    mergeableState:
      readString(entry, "mergeableState") ?? readString(entry, "mergeable_state") ?? null,
    metadataError:
      readString(entry, "metadataError") ?? readString(entry, "metadata_error") ?? null,
    prNumber: readNumber(entry, "prNumber") ?? readNumber(entry, "pr_number") ?? null,
    prCreatedAt: readString(entry, "prCreatedAt") ?? readString(entry, "pr_created_at") ?? null,
    prTitle: readString(entry, "prTitle") ?? readString(entry, "pr_title") ?? null,
    prUrl: readString(entry, "prUrl") ?? readString(entry, "pr_url") ?? "",
    projectName: readString(entry, "projectName") ?? readString(entry, "project_name") ?? null,
    projectSlug: readString(entry, "projectSlug") ?? readString(entry, "project_slug") ?? null,
    repoName: readString(entry, "repoName") ?? readString(entry, "repo_name") ?? null,
    repoOwner: readString(entry, "repoOwner") ?? readString(entry, "repo_owner") ?? null,
    requestedBy: normalizeRequestedBy(readObject(entry, "requestedBy")),
    requestedReviewerCount:
      readNumber(entry, "requestedReviewerCount") ??
      readNumber(entry, "requested_reviewer_count") ??
      null,
    requestedReviewerLogins:
      readStringArray(entry, "requestedReviewerLogins") ??
      readStringArray(entry, "requested_reviewer_logins") ??
      [],
    reviewCommentCount:
      readNumber(entry, "reviewCommentCount") ?? readNumber(entry, "review_comment_count") ?? null,
    runId: readString(entry, "runId") ?? readString(entry, "run_id") ?? `run-${index}`,
    source: readString(entry, "source") ?? "manual",
    status: readString(entry, "status") ?? "unknown",
    summary: readString(entry, "summary") ?? null,
    title: readString(entry, "title") ?? `Pull request ${index + 1}`,
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
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

export function statusTone(status: LoadStatus) {
  switch (status) {
    case "ready":
      return "success";
    case "error":
      return "danger";
    case "loading":
    case "unauthorized":
      return "warning";
    default:
      return "neutral";
  }
}

export function runnerTone(status: string, revokedAt?: string | null) {
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

export function tenantTone(status: string) {
  const normalizedStatus = status.toLowerCase();

  if (["active", "healthy", "ready"].includes(normalizedStatus)) {
    return "success";
  }

  if (["migrating", "pending", "provisioning"].includes(normalizedStatus)) {
    return "warning";
  }

  if (["failed", "error", "degraded"].includes(normalizedStatus)) {
    return "danger";
  }

  return "neutral";
}

export function dispatchReadinessTone(
  status: DispatchReadinessStatus | null | undefined,
  dispatchReady?: boolean,
) {
  if (dispatchReady) {
    return "success";
  }

  switch ((status ?? "").toLowerCase()) {
    case "blocked":
      return "danger";
    case "attention":
      return "warning";
    case "ready":
      return "success";
    default:
      return "neutral";
  }
}

export function deploymentTone(status: string) {
  const normalizedStatus = status.toLowerCase();

  if (normalizedStatus === "ready") {
    return "success";
  }

  if (["pending", "deploying"].includes(normalizedStatus)) {
    return "warning";
  }

  if (["failed", "error"].includes(normalizedStatus)) {
    return "danger";
  }

  return "neutral";
}

export function runTone(status: string) {
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

export function workspaceTone(workspace: Workspace) {
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

export function getRunQueueStage(run: RunRecord): QueueStage {
  const normalizedStatus = run.status.toLowerCase();

  if (["completed", "workspace_ready"].includes(normalizedStatus)) {
    return "completed";
  }

  if (["failed", "error"].includes(normalizedStatus)) {
    return "failed";
  }

  if (normalizedStatus === "blocked") {
    return "blocked";
  }

  if (["provisioning", "in_progress"].includes(normalizedStatus)) {
    return "provisioning";
  }

  if (normalizedStatus === "queued") {
    return "queued";
  }

  if (["running", "active"].includes(normalizedStatus)) {
    return "active";
  }

  return "other";
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

export async function retryRun(runId: string) {
  const payload = (await requestInternalApi(`/runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
  })) as { run?: unknown } | null;

  return payload?.run ? normalizeRun(payload.run) : null;
}

export function canRetryRun(run: RunRecord) {
  const normalizedStatus = run.status.toLowerCase();

  return !["queued", "provisioning", "in_progress", "running", "active"].includes(normalizedStatus);
}

export function getRunRetryActionLabel(run: RunRecord) {
  const normalizedStatus = run.status.toLowerCase();

  if (["blocked", "failed", "error"].includes(normalizedStatus)) {
    return "Retry run";
  }

  return "Re-dispatch";
}

export function getRunOperatorSummary(run: RunRecord) {
  if (run.failureMessage) {
    return run.failureMessage;
  }

  if (run.resultSummary) {
    return run.resultSummary;
  }

  const normalizedStatus = run.status.toLowerCase();

  switch (normalizedStatus) {
    case "queued":
      return "Queued and waiting for the next execution slot.";
    case "blocked":
      return "Blocked before the runtime bridge could continue.";
    case "provisioning":
    case "in_progress":
      return "Accepted by the backend and still moving through provisioning or execution.";
    case "workspace_ready":
      return "The devbox is ready and awaiting the next execution handoff.";
    case "completed":
      return "Completed without an explicit result summary.";
    case "failed":
    case "error":
      return "Execution failed without a recorded failure message.";
    default:
      return "No operator summary returned for this run yet.";
  }
}

export function getRunLastActivityAt(run: RunRecord) {
  return run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.queuedAt ?? run.createdAt ?? null;
}

export function getRunDispatchReceivedAt(run: RunRecord) {
  return run.dispatch?.createdAt ?? run.queuedAt ?? run.createdAt ?? null;
}

export function freshnessTone(
  value: string | null | undefined,
  options: {
    warningMinutes?: number;
    dangerMinutes?: number;
  } = {},
) {
  if (!value) {
    return "neutral" as const;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "neutral" as const;
  }

  const ageMinutes = (Date.now() - timestamp) / 60_000;
  const warningMinutes = options.warningMinutes ?? 30;
  const dangerMinutes = options.dangerMinutes ?? 120;

  if (ageMinutes >= dangerMinutes) {
    return "danger" as const;
  }

  if (ageMinutes >= warningMinutes) {
    return "warning" as const;
  }

  return "success" as const;
}

export function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function projectHasRepositoryRegistration(project: Project) {
  const readinessRepoConfigured = project.dispatchReadiness?.checks.repoConfigured;

  if (readinessRepoConfigured != null) {
    return readinessRepoConfigured;
  }

  return Boolean(
    project.repoProvider && project.repoOwner && project.repoName && project.defaultBranch,
  );
}

export function projectIsDispatchReady(project: Project) {
  return project.dispatchReadiness?.dispatchReady ?? false;
}

export function getDispatchReadinessLabel(readiness: DispatchReadiness | null | undefined) {
  if (!readiness) {
    return "dispatch unknown";
  }

  if (readiness.dispatchReady) {
    return "dispatch ready";
  }

  switch (readiness.status) {
    case "blocked":
      return "dispatch blocked";
    case "attention":
      return "dispatch attention";
    case "ready":
      return "dispatch ready";
    default:
      return "dispatch pending";
  }
}

export function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return fallback;
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

function readBoolean(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return typeof candidate === "boolean" ? candidate : null;
}

function readArray(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return Array.isArray(candidate) ? candidate : null;
}

function readObject(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return typeof candidate === "object" && candidate !== null ? candidate : null;
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

function normalizeWorkspace(entry: unknown, index: number): Workspace {
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
      readString(entry, "workspaceId") ?? readString(entry, "workspace_id") ?? `workspace-${index}`,
  };
}

function normalizeDispatchReadiness(value: unknown): DispatchReadiness | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const checks = readObject(value, "checks") ?? value;
  const dispatchReady =
    readBoolean(value, "dispatchReady") ?? readBoolean(value, "dispatch_ready") ?? false;
  const rawStatus = readString(value, "status")?.toLowerCase() ?? null;
  const issues = readStringArray(value, "issues") ?? [];
  const status: DispatchReadinessStatus =
    rawStatus === "ready" || rawStatus === "blocked" || rawStatus === "attention"
      ? rawStatus
      : dispatchReady
        ? "ready"
        : issues.length > 0
          ? "attention"
          : "unknown";

  return {
    checks: {
      codexExecutionConfigured:
        readBoolean(checks, "codexExecutionConfigured") ??
        readBoolean(checks, "codex_execution_configured"),
      githubTokenConfigured:
        readBoolean(checks, "githubTokenConfigured") ??
        readBoolean(checks, "github_token_configured"),
      platformProvisionerConfigured:
        readBoolean(checks, "platformProvisionerConfigured") ??
        readBoolean(checks, "platform_provisioner_configured"),
      repoConfigured:
        readBoolean(checks, "repoConfigured") ?? readBoolean(checks, "repo_configured"),
      sandboxOperatorHealthy:
        readBoolean(checks, "sandboxOperatorHealthy") ??
        readBoolean(checks, "sandbox_operator_healthy"),
      sandboxWorkspaceApiHealthy:
        readBoolean(checks, "sandboxWorkspaceApiHealthy") ??
        readBoolean(checks, "sandbox_workspace_api_healthy"),
    },
    detail: readString(value, "detail") ?? null,
    dispatchReady,
    issues,
    status,
  };
}

function normalizeBlueprintSteps(entries: unknown[] | null): BlueprintStep[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    key: readString(entry, "key") ?? `step-${index + 1}`,
    kind:
      (readString(entry, "kind") as BlueprintStep["kind"] | null) ??
      (readString(entry, "stepKind") as BlueprintStep["kind"] | null) ??
      "deterministic",
    label: readString(entry, "label") ?? `Step ${index + 1}`,
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

function normalizeRequestedBy(value: unknown): RunRequestedBy | null {
  const id = readString(value, "id");

  if (!id) {
    return null;
  }

  return {
    email: readString(value, "email") ?? "",
    id,
    name: readString(value, "name") ?? readString(value, "email") ?? "Unknown operator",
  };
}

function normalizeOptionalDispatch(value: unknown): DispatchRecord | null {
  const id = readString(value, "id");

  if (!id) {
    return null;
  }

  return {
    createdAt: readString(value, "createdAt") ?? readString(value, "created_at") ?? null,
    id,
    objective: readString(value, "objective") ?? null,
    requestedBy: normalizeRequestedBy(readObject(value, "requestedBy")),
    requestedByEmail:
      readString(value, "requestedByEmail") ?? readString(value, "requested_by_email") ?? null,
    requestedByName:
      readString(value, "requestedByName") ?? readString(value, "requested_by_name") ?? null,
    source: readString(value, "source") ?? "manual",
    title: readString(value, "title") ?? "Dispatch",
    updatedAt: readString(value, "updatedAt") ?? readString(value, "updated_at") ?? null,
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
    url: readString(entry, "url") ?? null,
    value: readString(entry, "value") ?? null,
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

function normalizeStepRecords(entries: unknown[] | null): RunStepRecord[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    createdAt: readString(entry, "createdAt") ?? readString(entry, "created_at") ?? null,
    details: readString(entry, "details") ?? null,
    id: readString(entry, "id") ?? `run-step-${index}`,
    label: readString(entry, "label") ?? `Step ${index + 1}`,
    position: readNumber(entry, "position") ?? index,
    status: readString(entry, "status") ?? "queued",
    stepKey: readString(entry, "stepKey") ?? readString(entry, "step_key") ?? `step-${index}`,
    stepKind: readString(entry, "stepKind") ?? readString(entry, "step_kind") ?? "deterministic",
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  }));
}

function normalizeOptionalWorkspace(value: unknown): Workspace | null {
  if (!value) {
    return null;
  }

  return normalizeWorkspace(value, 0);
}

function readTruthyString(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((result, [key, entry]) => {
    if (typeof entry === "string") {
      result[key] = entry;
    } else if (typeof entry === "number" || typeof entry === "boolean") {
      result[key] = String(entry);
    }

    return result;
  }, {});
}
