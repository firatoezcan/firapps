import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  ClipboardList,
  ExternalLink,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

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
import { CustomerRouteNavigation } from "../lib/customer-route-navigation";
import {
  clearCustomerMemberRunsSnapshot,
  clearCustomerOperationsSnapshot,
  refreshCustomerOperationsSnapshot,
  useCustomerMemberRunsCollection,
  useCustomerOperationsCollection,
  type MemberRunScope,
} from "../lib/customer-product-data";
import { toErrorMessage } from "../lib/customer-auth";
import {
  type LoadStatus,
  type RunRecord,
  formatDate,
  getRunPullRequestUrl,
  runTone,
  statusTone,
} from "../lib/internal-control-plane";

export const Route = createFileRoute("/runs")({
  component: RunsRoute,
});

function RunsRoute() {
  const location = useLocation();
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;

  const [runStatus, setRunStatus] = useState<LoadStatus>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [scope, setScope] = useState<MemberRunScope | null>(null);
  const dataEnabled = Boolean(session && activeOrganization?.id);
  const memberRunCollection = useCustomerMemberRunsCollection(dataEnabled);
  const operationsCollection = useCustomerOperationsCollection(dataEnabled);
  const organizationRuns = dataEnabled ? memberRunCollection.organizationRuns : [];
  const runs = dataEnabled ? memberRunCollection.runs : [];
  const activity = dataEnabled ? operationsCollection.activity : [];

  if (location.pathname !== "/runs") {
    return <Outlet />;
  }

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setRunStatus("idle");
      setRunError(null);
      setScope(null);
      void Promise.all([
        clearCustomerMemberRunsSnapshot(),
        clearCustomerOperationsSnapshot(),
      ]).catch(() => undefined);
      return;
    }

    void refreshEverything();
  }, [activeOrganization?.id, session?.session.id]);

  const activeRunCount = runs.filter((run) => runTone(run.status) === "warning").length;
  const failedRunCount = runs.filter((run) => runTone(run.status) === "danger").length;
  const latestAttentionRun = runs.find((run) => runTone(run.status) === "danger") ?? null;

  async function refreshEverything() {
    if (!session) {
      return;
    }

    setRunStatus("loading");
    setRunError(null);

    try {
      const memberRunsResult = await refreshCustomerOperationsSnapshot({
        email: session.user.email,
        userId: session.user.id,
      });

      setScope(memberRunsResult.scope);
      setRunStatus("ready");
    } catch (caughtError) {
      setRunStatus("error");
      setRunError(toErrorMessage(caughtError, "Unable to load run history."));
      setScope(null);
      await Promise.all([
        clearCustomerMemberRunsSnapshot(),
        clearCustomerOperationsSnapshot(),
      ]).catch(() => undefined);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="My runs"
      description="A member-focused run history route for the active organization. Customer-web now depends on the explicit backend filter `requestedBy=self`, so the visible rows stay aligned with the signed-in member."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
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
        </>
      }
    >
      <CustomerRouteNavigation currentPath="/runs" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Runs currently visible for your signed-in member."
          label="My runs"
          tone={runs.length > 0 ? "success" : statusTone(runStatus)}
          value={String(runs.length)}
        />
        <StatCard
          detail="Visible member-scoped runs with active or queued status."
          label="In progress"
          tone={activeRunCount > 0 ? "warning" : statusTone(runStatus)}
          value={String(activeRunCount)}
        />
        <StatCard
          detail="Visible member-scoped runs that ended in failure."
          label="Failed"
          tone={failedRunCount > 0 ? "danger" : statusTone(runStatus)}
          value={String(failedRunCount)}
        />
        <StatCard
          detail="Organization rows scanned before applying the member view."
          label="Org sample"
          tone={organizationRuns.length > 0 ? "neutral" : statusTone(runStatus)}
          value={String(organizationRuns.length)}
        />
      </SectionGrid>

      {runError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Run history unavailable
              </CardTitle>
              <CardDescription>{runError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Member scope</CardTitle>
            <CardDescription>
              {scope?.label ?? "Waiting for the active Better Auth session and organization."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              {scope?.description ??
                "Set an active organization to load the member-scoped run surface."}
            </p>
            {scope?.requestedBy ? (
              <StatusPill tone="success">{`requestedBy=${scope.requestedBy}`}</StatusPill>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next action</CardTitle>
            <CardDescription>
              The fastest follow-up from the member-scoped run slice.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {!latestAttentionRun && runs.length === 0 ? (
              <p>
                No run is visible yet. Keep this page as the place to check once the first dispatch
                lands.
              </p>
            ) : latestAttentionRun ? (
              <>
                <p>
                  <span className="font-medium text-foreground">{latestAttentionRun.title}</span>{" "}
                  needs attention.
                </p>
                <p>
                  {latestAttentionRun.failureMessage ??
                    latestAttentionRun.resultSummary ??
                    "Open the detail page to inspect the current outcome."}
                </p>
                <Button asChild size="sm" type="button">
                  <Link params={{ runId: latestAttentionRun.id }} to="/runs/$runId">
                    Open failing run
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <p>
                  <span className="font-medium text-foreground">{runs[0]?.title}</span> is the
                  latest visible run.
                </p>
                <p>{getMemberRunNextAction(runs[0]!)}</p>
                <Button asChild size="sm" type="button">
                  <Link params={{ runId: runs[0]!.id }} to="/runs/$runId">
                    Open latest run
                  </Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-5" />
              Organization activity
            </CardTitle>
            <CardDescription>
              This event stream is still organization-scoped because the current backend surface
              does not expose member-specific activity filters.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent organization activity is visible right now.
              </p>
            ) : (
              activity.slice(0, 8).map((entry) => (
                <div className="rounded-xl border p-3" key={entry.id}>
                  <p className="font-medium">{entry.title}</p>
                  <p className="text-sm text-muted-foreground">{entry.description}</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                    {entry.kind} • {formatDate(entry.occurredAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-5" />
              Your recent runs
            </CardTitle>
            <CardDescription>
              Visible rows from `/api/internal/runs`, narrowed to the current member when necessary.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No member-scoped runs are visible for the active organization yet.
              </p>
            ) : (
              runs.map((run) => (
                <div className="rounded-xl border p-4" key={run.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{run.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {run.projectName ?? "Unknown project"} • requested{" "}
                        {formatDate(run.createdAt)}
                      </p>
                    </div>
                    <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                    <RunField label="Objective" value={run.objective || "No objective provided"} />
                    <RunField
                      label="Requested by"
                      value={run.requestedBy?.name ?? run.requestedBy?.email ?? "Not exposed"}
                    />
                    <RunField
                      label="Result summary"
                      value={run.resultSummary ?? "No result summary yet"}
                    />
                    <RunField
                      label="Workspace"
                      value={run.workspace?.name ?? run.workspace?.workspaceId ?? "No workspace"}
                    />
                    <RunField
                      label="Last update"
                      value={formatDate(
                        run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt,
                      )}
                    />
                    <RunField
                      label="Step progress"
                      value={`${run.stepCounts.completed}/${run.stepCounts.total} completed`}
                    />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {getMemberRunNextAction(run)}
                  </p>
                  {run.failureMessage ? (
                    <p className="mt-3 text-sm text-red-900 dark:text-red-100">
                      Failure: {run.failureMessage}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild size="sm" type="button" variant="outline">
                      <Link params={{ runId: run.id }} to="/runs/$runId">
                        Open detail page
                      </Link>
                    </Button>
                    {getRunPullRequestUrl(run) ? (
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={getRunPullRequestUrl(run)!} rel="noreferrer" target="_blank">
                          <ExternalLink className="size-4" />
                          Open PR
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function RunField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function getMemberRunNextAction(run: RunRecord) {
  if (run.failureMessage || runTone(run.status) === "danger") {
    return "Review the failing step, artifacts, and branch evidence before retrying through admin.";
  }

  if (getRunPullRequestUrl(run)) {
    return "A pull request is already attached. Open it to review the diff and current status.";
  }

  if (run.branchName) {
    return "Branch output exists without a PR URL yet. Open the detail page for the latest evidence.";
  }

  if (run.workspace?.ideUrl) {
    return "A workspace is attached. Use the detail page if you need the latest devbox and artifact links.";
  }

  return "Open the detail page to inspect steps, artifacts, and lifecycle events.";
}
