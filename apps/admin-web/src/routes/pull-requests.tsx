import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  RotateCcw,
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

import { authClient } from "../lib/auth-client";
import {
  type Blueprint,
  type LoadStatus,
  type PullRequestRecord,
  type RunRecord,
  canRetryRun,
  formatDateWithRelative,
  freshnessTone,
  getRunDispatchReceivedAt,
  getRunLastActivityAt,
  getRunOperatorSummary,
  getRunPullRequestUrl,
  getRunStep,
  normalizeBlueprints,
  normalizePullRequests,
  normalizeRuns,
  requestInternalApi,
  retryRun,
  runTone,
  statusTone,
  toErrorMessage,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

export const Route = createFileRoute("/pull-requests")({
  component: PullRequestsRoute,
});

function PullRequestsRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageRuns = activeRole === "owner" || activeRole === "admin";

  const [pullRequestStatus, setPullRequestStatus] = useState<LoadStatus>("idle");
  const [pullRequestError, setPullRequestError] = useState<string | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);

  const [runStatus, setRunStatus] = useState<LoadStatus>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);

  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setPullRequestStatus("idle");
      setPullRequestError(null);
      setPullRequests([]);
      setRunStatus("idle");
      setRunError(null);
      setRuns([]);
      setBlueprintError(null);
      setBlueprints([]);
      setRetryingRunId(null);
      setNotice(null);
      return;
    }

    void refreshEverything();
  }, [activeOrganization?.id, session?.session.id]);

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);

  const branchOnlyRows = useMemo(
    () =>
      runs
        .map((run) => ({
          openPullRequestStep: getRunStep(run, "open_pull_request"),
          prEvidenceUrl: getRunPullRequestUrl(run),
          run,
        }))
        .filter(
          (row) =>
            !pullRequests.some((item) => item.runId === row.run.id) &&
            row.run.branchName &&
            !row.prEvidenceUrl,
        ),
    [runs, pullRequests],
  );
  const retryCandidates = useMemo(
    () =>
      runs.filter((run) => {
        const openPullRequestStep = getRunStep(run, "open_pull_request");
        const normalizedStatus = run.status.toLowerCase();

        return (
          canRetryRun(run) &&
          (normalizedStatus === "failed" ||
            normalizedStatus === "blocked" ||
            openPullRequestStep?.status?.toLowerCase() === "failed" ||
            (!!run.branchName && !pullRequests.some((item) => item.runId === run.id)))
        );
      }),
    [pullRequests, runs],
  );
  const prBlueprints = useMemo(
    () =>
      blueprints.filter((blueprint) =>
        blueprint.steps.some(
          (step) =>
            step.key === "open_pull_request" || step.label.toLowerCase().includes("pull request"),
        ),
      ),
    [blueprints],
  );
  const reviewReadyRows = useMemo(
    () => pullRequests.filter((row) => isReviewReady(row)),
    [pullRequests],
  );
  const repairRows = useMemo(
    () => pullRequests.filter((row) => needsPullRequestRepair(row)),
    [pullRequests],
  );
  const metadataFallbackRows = useMemo(
    () => pullRequests.filter((row) => Boolean(row.metadataError)),
    [pullRequests],
  );
  const quietFollowUpCount = useMemo(
    () =>
      pullRequests.filter(
        (row) => getPullRequestFreshness(runById.get(row.runId) ?? null, row).tone === "danger",
      ).length +
      branchOnlyRows.filter((row) => getBranchFollowUpFreshness(row.run).tone === "danger").length,
    [branchOnlyRows, pullRequests, runById],
  );

  async function refreshEverything() {
    await Promise.all([refreshPullRequests(), refreshRuns(), refreshBlueprints()]);
  }

  async function refreshPullRequests() {
    setPullRequestStatus("loading");
    setPullRequestError(null);

    try {
      const payload = (await requestInternalApi("/pull-requests")) as {
        pullRequests?: unknown[];
      } | null;

      setPullRequests(normalizePullRequests(payload?.pullRequests));
      setPullRequestStatus("ready");
    } catch (caughtError) {
      setPullRequestStatus("error");
      setPullRequestError(toErrorMessage(caughtError, "Unable to load pull request inventory."));
      setPullRequests([]);
    }
  }

  async function refreshRuns() {
    setRunStatus("loading");
    setRunError(null);

    try {
      const payload = (await requestInternalApi("/runs")) as {
        runs?: unknown[];
      } | null;

      setRuns(normalizeRuns(payload?.runs));
      setRunStatus("ready");
    } catch (caughtError) {
      setRunStatus("error");
      setRunError(toErrorMessage(caughtError, "Unable to load run inventory."));
      setRuns([]);
    }
  }

  async function refreshBlueprints() {
    setBlueprintError(null);

    try {
      const payload = (await requestInternalApi("/blueprints")) as {
        blueprints?: unknown[];
      } | null;

      setBlueprints(normalizeBlueprints(payload?.blueprints));
    } catch (caughtError) {
      setBlueprintError(toErrorMessage(caughtError, "Unable to load blueprint registry."));
      setBlueprints([]);
    }
  }

  async function handleRetryRun(run: RunRecord) {
    setRetryingRunId(run.id);
    setNotice(null);

    try {
      const retriedRun = await retryRun(run.id);

      setNotice({
        message: retriedRun
          ? `Re-dispatch queued as ${retriedRun.title}.`
          : "Re-dispatch accepted.",
        tone: "success",
      });
      await refreshEverything();
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
      title="Pull request visibility"
      description="A PR-focused route over the existing pull-request, run, and blueprint endpoints. It now combines direct PR rows with GitHub metadata, freshness cues, and branch-only follow-up so launch prep is less guesswork."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh pull requests"
            onClick={() => void refreshEverything()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/pull-requests" />

      <SectionGrid className="xl:grid-cols-5">
        <StatCard
          detail="Rows returned by `/api/internal/pull-requests`."
          label="PR links"
          tone={pullRequests.length > 0 ? "success" : statusTone(pullRequestStatus)}
          value={String(pullRequests.length)}
        />
        <StatCard
          detail="Open pull requests that look reviewable with the current metadata."
          label="Needs review"
          tone={reviewReadyRows.length > 0 ? "success" : statusTone(pullRequestStatus)}
          value={String(reviewReadyRows.length)}
        />
        <StatCard
          detail="PRs with failing checks, blocked mergeability, or metadata fallback."
          label="Needs repair"
          tone={repairRows.length > 0 ? "danger" : statusTone(pullRequestStatus)}
          value={String(repairRows.length)}
        />
        <StatCard
          detail="Runs that exposed a branch but still have no PR row."
          label="Branch only"
          tone={branchOnlyRows.length > 0 ? "warning" : statusTone(runStatus)}
          value={String(branchOnlyRows.length)}
        />
        <StatCard
          detail="Runs that operators can replay when PR evidence never landed cleanly."
          label="Retryable"
          tone={retryCandidates.length > 0 ? "warning" : statusTone(runStatus)}
          value={String(retryCandidates.length)}
        />
      </SectionGrid>

      {pullRequestError || runError || blueprintError ? (
        <SectionGrid>
          <InfoCard
            description={
              pullRequestError ??
              runError ??
              blueprintError ??
              "Pull request data could not be loaded."
            }
            title="PR data unavailable"
          />
        </SectionGrid>
      ) : null}

      {notice ? (
        <SectionGrid>
          <InfoCard
            description={notice.message}
            title={notice.tone === "success" ? "PR action submitted" : "PR action failed"}
          />
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Review attention</CardTitle>
            <CardDescription>
              The PR follow-ups that are most likely to need a human decision next.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pullRequests.length === 0 && branchOnlyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No review follow-up rows are visible right now.
              </p>
            ) : (
              [...repairRows, ...reviewReadyRows].slice(0, 6).map((row) => {
                const relatedRun = runById.get(row.runId) ?? null;

                return (
                  <div className="rounded-xl border p-3" key={`attention-${row.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{row.prTitle ?? row.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {row.projectName ?? row.projectSlug ?? "Unknown project"}
                        </p>
                      </div>
                      <StatusPill tone={needsPullRequestRepair(row) ? "danger" : "success"}>
                        {needsPullRequestRepair(row) ? "repair" : "review"}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {getPullRequestNextAction(row, relatedRun)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={row.prUrl} rel="noreferrer" target="_blank">
                          <ExternalLink className="size-4" />
                          Open PR
                        </a>
                      </Button>
                      <Button asChild size="sm" type="button" variant="outline">
                        <Link params={{ runId: row.runId }} to="/runs/$runId">
                          Open run
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
            {quietFollowUpCount > 0 ? (
              <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                {quietFollowUpCount} PR or branch follow-up rows have gone quiet based on their
                latest visible timestamps.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitPullRequest className="size-5" />
              Exposed pull requests
            </CardTitle>
            <CardDescription>
              Direct rows from the pull-request endpoint, including source, project, the run that
              opened them, and GitHub-native metadata when the backend can read it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pullRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pull requests are visible for the active organization yet.
              </p>
            ) : (
              pullRequests.map((row) => {
                const relatedRun = runById.get(row.runId) ?? null;
                const freshness = getPullRequestFreshness(relatedRun, row);

                return (
                  <div className="rounded-xl border p-3" key={row.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{row.prTitle ?? row.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {row.projectName ?? row.projectSlug ?? "Unknown project"} •{" "}
                          {(row.repoOwner && row.repoName
                            ? `${row.repoOwner}/${row.repoName}`
                            : null) ??
                            row.branchName ??
                            "No branch exposed"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusPill tone={freshness.tone}>{freshness.label}</StatusPill>
                        <StatusPill tone={runTone(row.status)}>{row.status}</StatusPill>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={row.prUrl} rel="noreferrer" target="_blank">
                          <ExternalLink className="size-4" />
                          Open PR
                        </a>
                      </Button>
                      <Button asChild size="sm" type="button" variant="outline">
                        <Link params={{ runId: row.runId }} to="/runs/$runId">
                          Open run
                        </Link>
                      </Button>
                      <span className="text-muted-foreground">
                        Opened {formatDateWithRelative(row.prCreatedAt ?? row.createdAt)}
                      </span>
                      {row.githubUpdatedAt ? (
                        <span className="text-muted-foreground">
                          GitHub updated {formatDateWithRelative(row.githubUpdatedAt)}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">Source: {row.source}</span>
                      {row.prNumber != null ? (
                        <span className="text-muted-foreground">PR #{row.prNumber}</span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm">
                      {row.githubState ? (
                        <StatusPill tone={githubStateTone(row.githubState, row.isDraft)}>
                          {row.isDraft ? `draft ${row.githubState}` : row.githubState}
                        </StatusPill>
                      ) : null}
                      {row.checksStatus ? (
                        <StatusPill tone={checksStatusTone(row.checksStatus)}>
                          checks {row.checksStatus}
                        </StatusPill>
                      ) : null}
                      {row.mergeableState ? (
                        <StatusPill tone={mergeableStateTone(row.mergeableState)}>
                          {row.mergeableState}
                        </StatusPill>
                      ) : null}
                      {row.authorLogin ? (
                        <StatusPill tone="neutral">@{row.authorLogin}</StatusPill>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">
                        {getPullRequestNextAction(row, relatedRun)}
                      </p>
                      <p>
                        Last backend update:{" "}
                        {formatDateWithRelative(
                          relatedRun ? getRunLastActivityAt(relatedRun) : row.updatedAt,
                        )}
                      </p>
                      {(row.headBranch ?? row.baseBranch) ? (
                        <p>
                          Branches: {row.headBranch ?? row.branchName ?? "unknown"}{" "}
                          {row.baseBranch ? `-> ${row.baseBranch}` : ""}
                        </p>
                      ) : null}
                      {row.commitCount != null ||
                      row.changedFiles != null ||
                      row.githubLineChangeCount != null ||
                      row.additions != null ||
                      row.deletions != null ? (
                        <p>
                          Commits: {row.commitCount ?? 0} • Files: {row.changedFiles ?? 0} • Lines:{" "}
                          {row.githubLineChangeCount ?? 0} • +{row.additions ?? 0} / -
                          {row.deletions ?? 0}
                        </p>
                      ) : null}
                      <p>
                        Requested reviewers: {row.requestedReviewerCount ?? 0} • Comments:{" "}
                        {row.commentCount ?? 0} • Review comments: {row.reviewCommentCount ?? 0}
                      </p>
                      {row.requestedReviewerLogins && row.requestedReviewerLogins.length > 0 ? (
                        <p>Reviewer logins: {row.requestedReviewerLogins.join(", ")}</p>
                      ) : null}
                      <p>
                        Requested by:{" "}
                        {relatedRun?.dispatch?.requestedBy?.name ??
                          row.requestedBy?.name ??
                          "Unknown requester"}
                      </p>
                    </div>
                    {row.labels && row.labels.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        {row.labels.map((label) => (
                          <StatusPill key={`${row.id}-${label}`} tone="neutral">
                            {label}
                          </StatusPill>
                        ))}
                      </div>
                    ) : null}
                    {row.summary ? (
                      <p className="mt-3 text-sm text-muted-foreground">{row.summary}</p>
                    ) : null}
                    {row.metadataError ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        GitHub metadata fallback: {row.metadataError}
                      </p>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-5" />
              Branches awaiting PR evidence
            </CardTitle>
            <CardDescription>
              Runs with a branch name but no PR row yet. This is the clearest current signal for
              “code moved, but PR evidence has not landed”, and the cards below show how old that
              follow-up is.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {branchOnlyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No branch-only runs are visible right now.
              </p>
            ) : (
              branchOnlyRows.slice(0, 8).map((row) => {
                const freshness = getBranchFollowUpFreshness(row.run);

                return (
                  <div className="rounded-xl border p-3" key={row.run.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{row.run.branchName}</p>
                        <p className="text-sm text-muted-foreground">
                          {row.run.projectName ?? "Unknown project"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusPill tone={freshness.tone}>{freshness.label}</StatusPill>
                        <StatusPill tone={runTone(row.run.status)}>{row.run.status}</StatusPill>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      <p>
                        Dispatch received{" "}
                        {formatDateWithRelative(getRunDispatchReceivedAt(row.run))}
                      </p>
                      <p>
                        Last backend update {formatDateWithRelative(getRunLastActivityAt(row.run))}
                      </p>
                      <p className="font-medium text-foreground">
                        {getBranchOnlyNextAction(row.run)}
                      </p>
                      <p>{row.openPullRequestStep?.details ?? getRunOperatorSummary(row.run)}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild size="sm" type="button" variant="outline">
                        <Link params={{ runId: row.run.id }} to="/runs/$runId">
                          Open run
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="size-5" />
              Re-dispatch candidates
            </CardTitle>
            <CardDescription>
              Runs that failed, blocked, or reached branch output without a visible PR row yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {retryCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No PR follow-up runs need a replay right now.
              </p>
            ) : (
              retryCandidates.slice(0, 6).map((run) => (
                <div className="rounded-xl border p-3" key={`retry-${run.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{run.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {run.projectName ?? "Unknown project"} • {run.branchName ?? "No branch yet"}
                      </p>
                    </div>
                    <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <p>{getPullRequestRetryReason(run, pullRequests)}</p>
                    <p>Last backend update {formatDateWithRelative(getRunLastActivityAt(run))}</p>
                    <p>{getRunOperatorSummary(run)}</p>
                  </div>
                  {canManageRuns ? (
                    <Button
                      className="mt-3"
                      disabled={retryingRunId === run.id}
                      onClick={() => void handleRetryRun(run)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RotateCcw className="size-4" />
                      {retryingRunId === run.id ? "Submitting..." : "Re-dispatch run"}
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Blueprint coverage</CardTitle>
            <CardDescription>
              Blueprint steps are the only structured PR-intent signal currently available.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {prBlueprints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No blueprint explicitly declares an `open_pull_request` step yet.
              </p>
            ) : (
              prBlueprints.map((blueprint) => (
                <div className="rounded-xl border p-3" key={blueprint.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{blueprint.name}</p>
                      <p className="text-sm text-muted-foreground">{blueprint.description}</p>
                    </div>
                    <StatusPill tone={blueprint.isActive ? "success" : "warning"}>
                      {blueprint.scope}
                    </StatusPill>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <InfoCard
          description={`This route now treats PR visibility as an operations surface: review-ready rows, repair-needed rows, ${metadataFallbackRows.length} metadata fallback row(s), and branch-only follow-up all stay visible without inventing extra backend contracts.`}
          title="Contract boundary"
        />
      </SectionGrid>
    </AppPage>
  );
}

function InfoCard({ description, title }: { description: string; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function getPullRequestFreshness(run: RunRecord | null, row: PullRequestRecord) {
  const tone = freshnessTone(run ? getRunLastActivityAt(run) : (row.updatedAt ?? row.createdAt), {
    dangerMinutes: 24 * 60,
    warningMinutes: 6 * 60,
  });

  return {
    label: tone === "danger" ? "quiet" : tone === "warning" ? "watch" : "fresh",
    tone,
  };
}

function getBranchFollowUpFreshness(run: RunRecord) {
  const tone = freshnessTone(getRunLastActivityAt(run) ?? getRunDispatchReceivedAt(run), {
    dangerMinutes: 6 * 60,
    warningMinutes: 90,
  });

  return {
    label: tone === "danger" ? "quiet" : tone === "warning" ? "watch" : "fresh",
    tone,
  };
}

function getPullRequestRetryReason(run: RunRecord, pullRequests: PullRequestRecord[]) {
  const openPullRequestStep = getRunStep(run, "open_pull_request");

  if (run.status.toLowerCase() === "blocked") {
    return "Blocked before the PR handoff completed.";
  }

  if (run.status.toLowerCase() === "failed") {
    return "Run failed before it produced stable PR evidence.";
  }

  if (openPullRequestStep?.status?.toLowerCase() === "failed") {
    return "The explicit PR-opening step failed.";
  }

  if (run.branchName && !pullRequests.some((item) => item.runId === run.id)) {
    return "A branch exists, but the control plane still has no PR row for it.";
  }

  return "Operator replay is available for this PR follow-up gap.";
}

function checksStatusTone(status: string) {
  const normalizedStatus = status.toLowerCase();

  if (normalizedStatus === "success") {
    return "success";
  }

  if (["failure", "error"].includes(normalizedStatus)) {
    return "danger";
  }

  if (["pending", "neutral"].includes(normalizedStatus)) {
    return "warning";
  }

  return "neutral";
}

function githubStateTone(state: string, isDraft?: boolean | null) {
  if (isDraft) {
    return "warning";
  }

  const normalizedState = state.toLowerCase();

  if (normalizedState === "open") {
    return "success";
  }

  if (normalizedState === "closed") {
    return "neutral";
  }

  return "warning";
}

function mergeableStateTone(state: string) {
  const normalizedState = state.toLowerCase();

  if (["clean", "has_hooks"].includes(normalizedState)) {
    return "success";
  }

  if (["blocked", "dirty", "behind", "unstable"].includes(normalizedState)) {
    return "danger";
  }

  if (["draft", "unknown"].includes(normalizedState)) {
    return "warning";
  }

  return "neutral";
}

function needsPullRequestRepair(row: PullRequestRecord) {
  const checksStatus = row.checksStatus?.toLowerCase();
  const mergeableState = row.mergeableState?.toLowerCase();

  return Boolean(
    row.metadataError ||
    checksStatus === "failure" ||
    checksStatus === "error" ||
    ["blocked", "dirty", "behind", "unstable"].includes(mergeableState ?? ""),
  );
}

function isReviewReady(row: PullRequestRecord) {
  const githubState = row.githubState?.toLowerCase();

  if (githubState && githubState !== "open") {
    return false;
  }

  if (row.isDraft || needsPullRequestRepair(row)) {
    return false;
  }

  return true;
}

function getPullRequestNextAction(row: PullRequestRecord, relatedRun: RunRecord | null) {
  if (needsPullRequestRepair(row)) {
    if (row.metadataError) {
      return "Check the linked run and GitHub access first; metadata enrichment fell back.";
    }

    if (row.checksStatus && ["failure", "error"].includes(row.checksStatus.toLowerCase())) {
      return "Checks failed. Open the PR and linked run to inspect what needs fixing.";
    }

    if (
      row.mergeableState &&
      ["blocked", "dirty", "behind", "unstable"].includes(row.mergeableState.toLowerCase())
    ) {
      return `Mergeability is ${row.mergeableState}. Resolve that before asking for review.`;
    }
  }

  if (row.isDraft) {
    return "Still draft. Finish the run output review before requesting human review.";
  }

  if ((row.requestedReviewerCount ?? 0) > 0) {
    return `Waiting on ${(row.requestedReviewerCount ?? 0).toString()} reviewer request(s); confirm checks and mergeability.`;
  }

  if (relatedRun?.resultSummary) {
    return "PR is visible. Compare the run summary with the current diff and checks.";
  }

  return "PR is visible and looks ready for human review.";
}

function getBranchOnlyNextAction(run: RunRecord) {
  if (run.failureMessage) {
    return "The run has branch output but also a failure signal. Inspect detail before retrying.";
  }

  if (getRunStep(run, "open_pull_request")?.status?.toLowerCase() === "failed") {
    return "The PR-opening step failed after branch creation. Check the run detail before replaying.";
  }

  return "A branch exists without a PR row. Open the run to decide whether to wait or re-dispatch.";
}
