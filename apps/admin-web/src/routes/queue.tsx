import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Clock3,
  ExternalLink,
  Gauge,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  Workflow,
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

import { buildCustomerSignInHref, getCurrentAdminPath } from "../lib/admin-sign-in-handoff";
import { authClient } from "../lib/auth-client";
import {
  type ActivityItem,
  type LoadStatus,
  type Overview,
  type RunRecord,
  canRetryRun,
  formatCount,
  formatDateWithRelative,
  freshnessTone,
  getRunDispatchReceivedAt,
  getRunLastActivityAt,
  getRunOperatorSummary,
  getRunQueueStage,
  getRunRetryActionLabel,
  normalizeActivity,
  normalizeOverview,
  normalizeRuns,
  requestInternalApi,
  retryRun,
  runTone,
  statusTone,
  toErrorMessage,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

export const Route = createFileRoute("/queue")({
  component: QueueRoute,
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

type QueueSummary = {
  active: number;
  blocked: number;
  failed: number;
  provisioning: number;
  queued: number;
  quiet: number;
  queueRuns: number;
};

type RuntimeCapacity = {
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

const emptyQueueSummary: QueueSummary = {
  active: 0,
  blocked: 0,
  failed: 0,
  provisioning: 0,
  queued: 0,
  quiet: 0,
  queueRuns: 0,
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

function QueueRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageRuns = activeRole === "owner" || activeRole === "admin";
  const signInHandoff = buildCustomerSignInHref(getCurrentAdminPath("/queue"), "/queue");

  const [runStatus, setRunStatus] = useState<LoadStatus>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [queueSummary, setQueueSummary] = useState<QueueSummary>(emptyQueueSummary);
  const [runtimeCapacity, setRuntimeCapacity] = useState<RuntimeCapacity>(emptyRuntimeCapacity);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setRunStatus("idle");
      setRunError(null);
      setRuns([]);
      setOverview(emptyOverview);
      setQueueSummary(emptyQueueSummary);
      setRuntimeCapacity(emptyRuntimeCapacity);
      setActivity([]);
      setRetryingRunId(null);
      setNotice(null);
      return;
    }

    void refreshQueueView();
  }, [activeOrganization?.id, session?.session.id]);

  useEffect(() => {
    if (!sessionQuery.isPending && !session && typeof window !== "undefined") {
      window.location.replace(signInHandoff.href);
    }
  }, [session, sessionQuery.isPending, signInHandoff.href]);

  const queueRuns = useMemo(
    () =>
      runs.filter((run) =>
        ["queued", "blocked", "provisioning", "active", "other"].includes(getRunQueueStage(run)),
      ),
    [runs],
  );
  const queuedRuns = queueRuns.filter((run) => getRunQueueStage(run) === "queued");
  const blockedRuns = queueRuns.filter((run) => getRunQueueStage(run) === "blocked");
  const quietQueueRuns = useMemo(
    () => queueRuns.filter((run) => getQueueFreshness(run).tone === "danger"),
    [queueRuns],
  );
  const attentionRuns = useMemo(
    () =>
      queueRuns
        .filter((run) => {
          const stage = getRunQueueStage(run);

          return (
            stage === "blocked" ||
            getQueueFreshness(run).tone !== "success" ||
            Boolean(run.failureMessage)
          );
        })
        .sort(
          (left, right) =>
            toTimestamp(getRunDispatchReceivedAt(left)) -
            toTimestamp(getRunDispatchReceivedAt(right)),
        ),
    [queueRuns],
  );
  const retryCandidates = useMemo(
    () =>
      runs.filter((run) => {
        const stage = getRunQueueStage(run);

        return canRetryRun(run) && ["blocked", "failed", "other"].includes(stage);
      }),
    [runs],
  );
  const waitingRuns = useMemo(
    () =>
      [...queuedRuns, ...blockedRuns].sort(
        (left, right) =>
          toTimestamp(getRunDispatchReceivedAt(left)) -
          toTimestamp(getRunDispatchReceivedAt(right)),
      ),
    [blockedRuns, queuedRuns],
  );
  const oldestWaitingRun = waitingRuns[0] ?? null;

  async function handleRetryRun(run: RunRecord) {
    setRetryingRunId(run.id);
    setNotice(null);

    try {
      const retriedRun = await retryRun(run.id);

      setNotice({
        message: retriedRun
          ? `${getRunRetryActionLabel(run)} queued as ${retriedRun.title}.`
          : `${getRunRetryActionLabel(run)} accepted.`,
        tone: "success",
      });
      await refreshQueueView();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to retry the selected run."),
        tone: "danger",
      });
    } finally {
      setRetryingRunId(null);
    }
  }

  async function refreshQueueView() {
    setRunStatus("loading");
    setRunError(null);

    try {
      const payload = (await requestInternalApi("/queue")) as {
        activity?: unknown[];
        overview?: unknown;
        queueSummary?: unknown;
        runtimeCapacity?: unknown;
        runs?: unknown[];
      } | null;

      setRuns(normalizeRuns(payload?.runs));
      setOverview(normalizeOverview(payload?.overview));
      setQueueSummary(normalizeQueueSummary(payload?.queueSummary));
      setRuntimeCapacity(normalizeRuntimeCapacity(payload?.runtimeCapacity));
      setActivity(normalizeActivity(payload?.activity));
      setRunStatus("ready");
    } catch (caughtError) {
      setRunStatus("error");
      setRunError(toErrorMessage(caughtError, "Unable to load queue health data."));
      setRuns([]);
      setOverview(emptyOverview);
      setQueueSummary(emptyQueueSummary);
      setRuntimeCapacity(emptyRuntimeCapacity);
      setActivity([]);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Run queue"
      description="A queue-facing view over the dedicated `/api/internal/queue` snapshot. It now reads one backend surface for queued work, queue-age health, recent activity, and the same retryable run detail used elsewhere in admin-web."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh queue"
            onClick={() => void refreshQueueView()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/queue" />

      <SectionGrid className="xl:grid-cols-5">
        <StatCard
          detail="Runs currently marked `queued`."
          label="Queued"
          tone={queueSummary.queued > 0 ? "warning" : statusTone(runStatus)}
          value={String(queueSummary.queued)}
        />
        <StatCard
          detail="Runs blocked by missing configuration or unavailable runtime inputs."
          label="Blocked"
          tone={queueSummary.blocked > 0 ? "danger" : statusTone(runStatus)}
          value={String(queueSummary.blocked)}
        />
        <StatCard
          detail="Runs the backend marks as `provisioning` or `in_progress`."
          label="Provisioning"
          tone={queueSummary.provisioning > 0 ? "warning" : statusTone(runStatus)}
          value={String(queueSummary.provisioning)}
        />
        <StatCard
          detail="Queue items with no backend activity for the current heuristic window."
          label="Quiet"
          tone={queueSummary.quiet > 0 ? "danger" : statusTone(runStatus)}
          value={String(queueSummary.quiet)}
        />
        <StatCard
          detail="Runs already eligible for retry or re-dispatch."
          label="Retryable"
          tone={retryCandidates.length > 0 ? "warning" : statusTone(runStatus)}
          value={String(retryCandidates.length)}
        />
      </SectionGrid>

      {runError ? (
        <SectionGrid>
          <MessageCard
            description={runError ?? "Queue data could not be loaded."}
            icon={<TriangleAlert className="size-5" />}
            title="Queue data unavailable"
          />
        </SectionGrid>
      ) : null}

      {notice ? (
        <SectionGrid>
          <MessageCard
            description={notice.message}
            icon={<RotateCcw className="size-5" />}
            title={notice.tone === "success" ? "Queue action submitted" : "Queue action failed"}
          />
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="size-5" />
              Needs attention
            </CardTitle>
            <CardDescription>
              Runs still waiting to start or blocked before the runtime bridge can move them
              forward, with dispatch age and last backend activity called out explicitly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {attentionRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No blocked, quiet, or failure-signaling runs are visible right now.
              </p>
            ) : (
              attentionRuns
                .slice(0, 8)
                .map((run) => (
                  <RunQueueCard
                    canManageRuns={canManageRuns}
                    isRetrying={retryingRunId === run.id}
                    key={run.id}
                    onRetry={() => void handleRetryRun(run)}
                    run={run}
                  />
                ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-5" />
              Capacity snapshot
            </CardTitle>
            <CardDescription>
              Queue counts paired with the provisioner runtime snapshot from the same backend
              surface, so operator capacity is no longer inferred only from timestamps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <KeyValue
              label="Waiting for movement"
              value={formatCount(runtimeCapacity.waitingRuns, "run")}
            />
            <KeyValue
              label="Currently executing"
              value={formatCount(runtimeCapacity.executingRuns, "run")}
            />
            <KeyValue
              label="Ready nodes"
              value={`${runtimeCapacity.readyNodes}/${runtimeCapacity.totalNodes}`}
            />
            <KeyValue
              label="Oldest waiting dispatch"
              value={
                oldestWaitingRun
                  ? formatDateWithRelative(getRunDispatchReceivedAt(oldestWaitingRun))
                  : "none waiting"
              }
            />
            <div className="rounded-xl border border-dashed p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Operator read</p>
                  <p className="mt-1 text-muted-foreground">{runtimeCapacity.detail}</p>
                </div>
                <StatusPill tone={runtimeCapacityTone(runtimeCapacity.capacityStatus)}>
                  {runtimeCapacityTone(runtimeCapacity.capacityStatus) === "danger"
                    ? "blocked"
                    : runtimeCapacityTone(runtimeCapacity.capacityStatus) === "warning"
                      ? "watch"
                      : "flowing"}
                </StatusPill>
              </div>
            </div>
            <p className="rounded-xl border border-dashed p-3 text-muted-foreground">
              Queue age and quiet/fresh labels still come from dispatch and run timestamps, but the
              node/workspace counters above now come from the provisioner runtime bridge instead of
              page-local heuristics alone.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow className="size-5" />
              Queue health
            </CardTitle>
            <CardDescription>
              High-level counters from `/overview` plus the derived quiet-run sample.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <KeyValue label="Run volume" value={formatCount(overview.runCount, "run")} />
            <KeyValue label="Failed runs" value={formatCount(overview.failedRuns, "run")} />
            <KeyValue label="Queued" value={formatCount(queuedRuns.length, "run")} />
            <KeyValue label="Blocked" value={formatCount(blockedRuns.length, "run")} />
            <KeyValue label="Quiet queue items" value={formatCount(quietQueueRuns.length, "run")} />
            <KeyValue label="Retryable now" value={formatCount(retryCandidates.length, "run")} />
            <KeyValue
              label="Provisioner workspaces"
              value={formatCount(runtimeCapacity.totalWorkspaces, "workspace")}
            />
            <KeyValue
              label="Failed workspaces"
              value={formatCount(runtimeCapacity.failedWorkspaces, "workspace")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Latest activity rows returned by `/api/internal/activity`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent activity was returned for the active organization.
              </p>
            ) : (
              activity.slice(0, 8).map((item) => (
                <div className="rounded-xl border p-3" key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <StatusPill tone={runTone(item.status)}>{item.status}</StatusPill>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateWithRelative(item.occurredAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="size-5" />
              Retry and re-dispatch
            </CardTitle>
            <CardDescription>
              Non-active runs that admins can replay through `/api/internal/runs/:runId/retry` when
              a queue item stalled, failed, or finished without the outcome the operator wanted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {retryCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No retry or re-dispatch candidates are visible right now.
              </p>
            ) : (
              retryCandidates
                .slice(0, 6)
                .map((run) => (
                  <RunQueueCard
                    canManageRuns={canManageRuns}
                    isRetrying={retryingRunId === run.id}
                    key={`retry-${run.id}`}
                    onRetry={() => void handleRetryRun(run)}
                    run={run}
                  />
                ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function RunQueueCard({
  canManageRuns,
  isRetrying,
  onRetry,
  run,
}: {
  canManageRuns: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  run: RunRecord;
}) {
  const queueStage = getRunQueueStage(run);
  const stageLabel = queueStage === "other" ? run.status : queueStage;
  const freshness = getQueueFreshness(run);
  const dispatchReceivedAt = getRunDispatchReceivedAt(run);
  const lastActivityAt = getRunLastActivityAt(run);
  const pullRequestUrl = run.prUrl;
  const requesterLabel =
    run.dispatch?.requestedBy?.name ??
    run.dispatch?.requestedByName ??
    run.requestedBy?.name ??
    "Unknown requester";
  const retryReadiness = canRetryRun(run)
    ? getRunRetryActionLabel(run)
    : freshness.tone === "danger"
      ? "Watch closely"
      : "Awaiting in-flight work";

  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium">{run.title}</p>
          <p className="text-sm text-muted-foreground">
            {run.projectName ?? "Unknown project"} • {run.blueprintName ?? "No blueprint name"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={freshness.tone}>{freshness.label}</StatusPill>
          <StatusPill tone={runTone(run.status)}>{stageLabel}</StatusPill>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
        <p>Dispatch source: {run.dispatch?.source ?? run.source}</p>
        <p>Requested by: {requesterLabel}</p>
        <p>Dispatch age: {formatDateWithRelative(dispatchReceivedAt)}</p>
        <p>Last visible movement: {formatDateWithRelative(lastActivityAt)}</p>
        <p>
          Steps: {run.stepCounts.completed}/{run.stepCounts.total} completed,{" "}
          {run.stepCounts.queued} queued
        </p>
        {run.workspace ? <p>Workspace: {run.workspace.status}</p> : null}
        {run.branchName ? <p>Branch: {run.branchName}</p> : null}
        {run.failureMessage ? (
          <p className="text-red-900 dark:text-red-100">Failure: {run.failureMessage}</p>
        ) : null}
        <p>Retry signal: {retryReadiness}</p>
        <p>{getRunOperatorSummary(run)}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm" type="button" variant="outline">
          <Link
            params={{ runId: run.id }}
            search={{
              blueprintId: run.blueprintId ?? undefined,
              projectId: run.tenantId ?? undefined,
            }}
            to="/runs/$runId"
          >
            Open run
          </Link>
        </Button>
        {pullRequestUrl ? (
          <Button asChild size="sm" type="button" variant="outline">
            <a href={pullRequestUrl} rel="noreferrer" target="_blank">
              <ExternalLink className="size-4" />
              Open PR
            </a>
          </Button>
        ) : null}
        {canManageRuns && canRetryRun(run) ? (
          <Button disabled={isRetrying} onClick={onRetry} size="sm" type="button" variant="outline">
            <RotateCcw className="size-4" />
            {isRetrying ? "Submitting..." : getRunRetryActionLabel(run)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function normalizeQueueSummary(entry: unknown): QueueSummary {
  if (!entry || typeof entry !== "object") {
    return emptyQueueSummary;
  }

  const value = entry as Record<string, unknown>;

  return {
    active: readNumber(value, "active") ?? 0,
    blocked: readNumber(value, "blocked") ?? 0,
    failed: readNumber(value, "failed") ?? 0,
    provisioning: readNumber(value, "provisioning") ?? 0,
    queued: readNumber(value, "queued") ?? 0,
    quiet: readNumber(value, "quiet") ?? 0,
    queueRuns: readNumber(value, "queueRuns") ?? readNumber(value, "queue_runs") ?? 0,
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

function getQueueFreshness(run: RunRecord) {
  const stage = getRunQueueStage(run);
  const referenceAt =
    stage === "queued" || stage === "blocked"
      ? getRunDispatchReceivedAt(run)
      : getRunLastActivityAt(run);
  const tone = freshnessTone(referenceAt, {
    dangerMinutes: stage === "provisioning" || stage === "active" ? 90 : 45,
    warningMinutes: stage === "provisioning" || stage === "active" ? 30 : 15,
  });

  return {
    label: tone === "danger" ? "quiet" : tone === "warning" ? "watch" : "fresh",
    tone,
  };
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function MessageCard({
  description,
  icon,
  title,
}: {
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function readNumber(entry: Record<string, unknown>, key: string) {
  const candidate = entry[key];

  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readString(entry: Record<string, unknown>, key: string) {
  const candidate = entry[key];

  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function runtimeCapacityTone(status: string) {
  switch (status) {
    case "blocked":
    case "failed":
    case "degraded":
      return "danger";
    case "warning":
      return "warning";
    case "healthy":
      return "success";
    default:
      return "neutral";
  }
}
