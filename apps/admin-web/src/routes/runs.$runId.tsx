import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  RefreshCw,
  RotateCcw,
  TerminalSquare,
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
import { retryAdminRun, useAdminRunDetail } from "../lib/admin-product-data";
import { authClient } from "../lib/auth-client";
import {
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
  toErrorMessage,
  workspaceTone,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

export const Route = createFileRoute("/runs/$runId")({
  component: RunDetailRoute,
});

function RunDetailRoute() {
  const navigate = useNavigate();
  const params = Route.useParams();
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canDispatchRuns = activeRole === "owner" || activeRole === "admin";
  const signInHandoff = buildCustomerSignInHref(
    getCurrentAdminPath(`/runs/${params.runId}`),
    `/runs/${params.runId}`,
  );

  const productCollectionsEnabled = Boolean(session && activeOrganization?.id);
  const runQuery = useAdminRunDetail(
    productCollectionsEnabled,
    activeOrganization?.id,
    params.runId,
  );
  const runStatus = runQuery.status;
  const runError = runQuery.error;
  const run = runQuery.run;
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const outcomeSummary = run ? getRunOutcomeSummary(run) : null;

  useEffect(() => {
    if (!sessionQuery.isPending && !session && typeof window !== "undefined") {
      window.location.replace(signInHandoff.href);
    }
  }, [session, sessionQuery.isPending, signInHandoff.href]);

  async function loadRunDetail() {
    await runQuery.refresh();
  }

  async function handleRetryRun(selectedRun: RunRecord) {
    setRetryingRunId(selectedRun.id);
    setNotice(null);

    try {
      const retriedRun = await retryAdminRun(selectedRun.id, selectedRun.tenantId);

      setNotice({
        message: retriedRun
          ? `${getRunRetryActionLabel(selectedRun)} queued as ${retriedRun.title}.`
          : `${getRunRetryActionLabel(selectedRun)} accepted.`,
        tone: "success",
      });

      if (retriedRun) {
        await navigate({
          params: {
            runId: retriedRun.id,
          },
          to: "/runs/$runId",
        });
        return;
      }

      await loadRunDetail();
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
      title={run?.title ?? "Run detail"}
      description={
        run
          ? "Route-level execution detail over the existing `/api/internal/runs/:runId` contract."
          : "Load one run from the current internal-api detail surface."
      }
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/runs">
              <ArrowRight className="size-4 rotate-180" />
              Back to runs
            </Link>
          </Button>
          <Button
            aria-label="Refresh run detail"
            onClick={() => void loadRunDetail()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/runs" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Current run status from the detail payload."
          label="Status"
          tone={run ? runTone(run.status) : statusTone(runStatus)}
          value={run?.status ?? runStatus}
        />
        <StatCard
          detail="Detailed step rows returned for this run."
          label="Steps"
          tone={run && (run.steps?.length ?? 0) > 0 ? "success" : statusTone(runStatus)}
          value={String(run?.steps?.length ?? 0)}
        />
        <StatCard
          detail="Artifacts currently attached to the run."
          label="Artifacts"
          tone={run && (run.artifacts?.length ?? 0) > 0 ? "success" : statusTone(runStatus)}
          value={String(run?.artifacts?.length ?? 0)}
        />
        <StatCard
          detail="Recent lifecycle events on this run."
          label="Events"
          tone={run && (run.events?.length ?? 0) > 0 ? "success" : statusTone(runStatus)}
          value={String(run?.events?.length ?? 0)}
        />
      </SectionGrid>

      {!session ? (
        <Card>
          <CardHeader>
            <CardTitle>Redirecting to customer sign in</CardTitle>
            <CardDescription>
              Signed-out deep links for run detail now hand off to customer-web sign-in and keep
              this run path ready for the return trip.
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
                <Link to="/runs">Back to runs</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}
      {runError ? <InlineNotice message={runError} tone="danger" /> : null}

      {session && run ? (
        <>
          <SectionGrid className="xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Outcome and next action</CardTitle>
                    <CardDescription>{outcomeSummary?.description}</CardDescription>
                  </div>
                  <StatusPill tone={outcomeSummary?.tone ?? runTone(run.status)}>
                    {outcomeSummary?.label ?? run.status}
                  </StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm">
                  <p className="font-medium text-foreground">{outcomeSummary?.nextAction}</p>
                  {run.failureMessage ? (
                    <p className="mt-2 text-red-900 dark:text-red-100">
                      Failure: {run.failureMessage}
                    </p>
                  ) : null}
                  {!run.failureMessage && run.resultSummary ? (
                    <p className="mt-2 text-muted-foreground">{run.resultSummary}</p>
                  ) : null}
                </div>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <SummaryField
                    label="PR evidence"
                    value={getRunPullRequestUrl(run) ?? "not attached"}
                  />
                  <SummaryField
                    label="Branch evidence"
                    value={
                      getArtifactValue(run, ["workspace_branch", "branch_name"]) ?? run.branchName
                    }
                  />
                  <SummaryField label="Failing step" value={getFailingStepDetail(run)} />
                  <SummaryField
                    label="Retry state"
                    value={
                      canRetryRun(run) ? getRunRetryActionLabel(run) : "Retry locked while active"
                    }
                  />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Execution timeline</CardTitle>
                <CardDescription>
                  The timestamps and step counts most operators check before opening raw artifacts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <TimelineRow label="Queued" value={formatDate(run.queuedAt ?? run.createdAt)} />
                <TimelineRow label="Started" value={formatDate(run.startedAt)} />
                <TimelineRow label="Completed" value={formatDate(run.completedAt)} />
                <TimelineRow label="Last activity" value={formatDate(getRunLastActivityAt(run))} />
                <TimelineRow
                  label="Progress"
                  value={`${run.stepCounts.completed}/${run.stepCounts.total} completed`}
                />
                <TimelineRow
                  label="Workspace"
                  value={
                    run.workspace
                      ? `${run.workspace.status} (${run.workspace.workspaceId})`
                      : "not attached"
                  }
                />
              </CardContent>
            </Card>
          </SectionGrid>

          <SectionGrid className="xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Workflow className="size-5" />
                      Summary
                    </CardTitle>
                    <CardDescription>{getRunOperatorSummary(run)}</CardDescription>
                  </div>
                  <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{run.projectName ?? run.tenantId}</p>
                      <p className="text-sm text-muted-foreground">
                        {run.requestedBy?.name ?? run.requestedBy?.email ?? "Unknown requestor"}
                      </p>
                    </div>
                    <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {run.objective || "No explicit objective was recorded for this run."}
                  </p>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2">
                  <SummaryField label="Source" value={run.source} />
                  <SummaryField
                    label="Last activity"
                    value={formatDate(getRunLastActivityAt(run))}
                  />
                  <SummaryField label="Queued" value={formatDate(run.queuedAt ?? run.createdAt)} />
                  <SummaryField label="Started" value={formatDate(run.startedAt)} />
                  <SummaryField label="Completed" value={formatDate(run.completedAt)} />
                  <SummaryField
                    label="Branch"
                    value={
                      getArtifactValue(run, ["workspace_branch", "branch_name"]) ?? run.branchName
                    }
                  />
                  <SummaryField
                    label="Report path"
                    value={getArtifactValue(run, ["execution_report_path", "run_report_path"])}
                  />
                  <SummaryField
                    label="Pull request"
                    value={getRunPullRequestUrl(run) ?? "No pull request URL attached yet."}
                  />
                </dl>

                <div className="flex flex-wrap gap-2">
                  {canDispatchRuns && canRetryRun(run) ? (
                    <Button
                      disabled={retryingRunId === run.id}
                      onClick={() => void handleRetryRun(run)}
                      type="button"
                      variant="outline"
                    >
                      <RotateCcw className="size-4" />
                      {retryingRunId === run.id ? "Submitting..." : getRunRetryActionLabel(run)}
                    </Button>
                  ) : null}
                  {getRunPullRequestUrl(run) ? (
                    <Button asChild type="button" variant="outline">
                      <a href={getRunPullRequestUrl(run)!} rel="noreferrer" target="_blank">
                        <ExternalLink className="size-4" />
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
                </div>
                {!canRetryRun(run) ? (
                  <p className="text-sm text-muted-foreground">
                    Re-dispatch stays disabled while the backend still considers this run active.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Workspace and devbox</CardTitle>
                <CardDescription>
                  Current workspace attachment, repo binding, and IDE access for this run.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {run.workspace ? (
                  <div className="rounded-2xl border border-border/60 bg-background/90 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">
                          {run.workspace.repoOwner}/{run.workspace.repoName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Workspace ID: {run.workspace.workspaceId}
                        </p>
                      </div>
                      <StatusPill tone={workspaceTone(run.workspace)}>
                        {run.workspace.status}
                      </StatusPill>
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <p>Provider: {run.workspace.provider}</p>
                      <p>Image flavor: {run.workspace.imageFlavor}</p>
                      <p>
                        Nix packages:{" "}
                        {run.workspace.nixPackages.length > 0
                          ? run.workspace.nixPackages.join(", ")
                          : "none requested"}
                      </p>
                      <p>Created: {formatDate(run.workspace.createdAt)}</p>
                      <p>Updated: {formatDate(run.workspace.updatedAt)}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {run.workspace.ideUrl ? (
                        <Button asChild type="button" variant="outline">
                          <a href={run.workspace.ideUrl} rel="noreferrer" target="_blank">
                            Open devbox
                          </a>
                        </Button>
                      ) : null}
                      {run.workspace.previewUrl ? (
                        <Button asChild type="button" variant="outline">
                          <a href={run.workspace.previewUrl} rel="noreferrer" target="_blank">
                            Open preview
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No workspace is attached to this run yet.
                  </p>
                )}

                <ArtifactList artifacts={run.artifacts ?? []} />
              </CardContent>
            </Card>
          </SectionGrid>

          <SectionGrid className="xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Execution outputs</CardTitle>
                <CardDescription>
                  Primary artifacts from the current execution bridge, including log and report
                  outputs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <KeyArtifactCard
                  icon={GitBranch}
                  label="Branch"
                  value={
                    getArtifactValue(run, ["workspace_branch", "branch_name"]) ?? run.branchName
                  }
                />
                <KeyArtifactCard
                  icon={FileText}
                  label="Report path"
                  value={getArtifactValue(run, ["execution_report_path", "run_report_path"])}
                />
                <CodeArtifactCard
                  artifact={getArtifact(run, ["execution_report_markdown"])}
                  icon={FileText}
                />
                <CodeArtifactCard
                  artifact={getArtifact(run, ["execution_report_patch"])}
                  icon={FileCode2}
                />
                <CodeArtifactCard
                  artifact={getArtifact(run, ["execution_log"])}
                  icon={TerminalSquare}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent run events</CardTitle>
                <CardDescription>
                  Lifecycle events already persisted for this run by the backend.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RunEventPanel events={run.events ?? []} />
              </CardContent>
            </Card>
          </SectionGrid>

          <SectionGrid>
            <Card>
              <CardHeader>
                <CardTitle>Execution steps</CardTitle>
                <CardDescription>
                  Ordered step records returned from `/api/internal/runs/:runId`.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {run.steps?.length ? (
                  run.steps.map((step) => <StepCard key={step.id} step={step} />)
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No detailed steps returned for this run yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </SectionGrid>
        </>
      ) : null}
    </AppPage>
  );
}

function SummaryField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/90 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p className="mt-2 break-all text-sm">
        {value && value.trim().length > 0 ? value : "unknown"}
      </p>
    </div>
  );
}

function KeyArtifactCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/90 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <p className="font-medium">{label}</p>
      </div>
      <p className="mt-3 break-all text-sm text-muted-foreground">
        {value && value.trim().length > 0 ? value : "Not attached yet."}
      </p>
    </div>
  );
}

function CodeArtifactCard({
  artifact,
  icon: Icon,
}: {
  artifact: RunArtifact | null;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/90 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <p className="font-medium">{artifact?.label ?? "Artifact pending"}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {artifact?.artifactType ?? "No artifact attached yet."}
      </p>
      <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-muted/30 p-3 text-xs leading-5 whitespace-pre-wrap">
        {artifact?.value ?? "No value has been attached yet."}
      </pre>
    </div>
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

function ArtifactList({ artifacts }: { artifacts: RunArtifact[] }) {
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

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/90 px-4 py-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function getArtifact(run: RunRecord, artifactTypes: string[]) {
  const normalizedTypes = artifactTypes.map((artifactType) => artifactType.toLowerCase());

  return (
    run.artifacts?.find((artifact) =>
      normalizedTypes.includes(artifact.artifactType.toLowerCase()),
    ) ?? null
  );
}

function getArtifactValue(run: RunRecord, artifactTypes: string[]) {
  const artifact = getArtifact(run, artifactTypes);

  return artifact?.value ?? artifact?.url ?? null;
}

function getFailingStepDetail(run: RunRecord) {
  const failingStep = [...(run.steps ?? [])]
    .reverse()
    .find((step) => step.status.toLowerCase() === "failed");

  if (!failingStep) {
    return "No failed step recorded";
  }

  return `${failingStep.label}${failingStep.details ? ` - ${failingStep.details}` : ""}`;
}

function getRunOutcomeSummary(run: RunRecord): {
  description: string;
  label: string;
  nextAction: string;
  tone: "danger" | "neutral" | "success" | "warning";
} {
  const prUrl = getRunPullRequestUrl(run);
  const failingStepDetail = getFailingStepDetail(run);
  const normalizedStatus = run.status.toLowerCase();

  if (run.failureMessage || normalizedStatus === "failed") {
    return {
      description: "The run ended in failure and needs a retry or a deeper step/artifact review.",
      label: "failed",
      nextAction: canRetryRun(run)
        ? "Inspect the failing step, then re-dispatch once the blocker is understood."
        : "The run still looks active to the backend, so wait for it to settle before retrying.",
      tone: "danger" as const,
    };
  }

  if (prUrl) {
    return {
      description: "The run already exposed reviewable PR evidence.",
      label: "pr ready",
      nextAction: "Open the pull request, check GitHub review state, and hand it off for review.",
      tone: "success" as const,
    };
  }

  if (run.branchName) {
    return {
      description: "Code moved onto a branch, but no pull request URL was attached yet.",
      label: "branch only",
      nextAction: "Inspect the branch and PR-opening step before deciding whether to re-dispatch.",
      tone: "warning" as const,
    };
  }

  if (!canRetryRun(run)) {
    return {
      description: "The backend still considers this run in flight.",
      label: "in progress",
      nextAction: "Watch recent events and workspace state until execution settles.",
      tone: "warning" as const,
    };
  }

  if (run.resultSummary || failingStepDetail !== "No failed step recorded") {
    return {
      description: "The run has textual outcome evidence, but not a full PR handoff yet.",
      label: "result ready",
      nextAction: "Check the summary, artifacts, and branch output before deciding on a replay.",
      tone: "warning" as const,
    };
  }

  return {
    description: "This run finished without much structured outcome evidence.",
    label: normalizedStatus,
    nextAction: "Use the event stream and artifacts below to decide whether it is safe to replay.",
    tone: runTone(run.status),
  };
}
