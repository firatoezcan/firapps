import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

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

import { useAdminActivity, useAdminOverview } from "../lib/admin-product-data";
import { authClient } from "../lib/auth-client";
import { type Overview, formatDate, runTone, statusTone } from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

export const Route = createFileRoute("/activity")({
  component: ActivityRoute,
});

function ActivityRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;

  const productCollectionsEnabled = Boolean(session && activeOrganization?.id);
  const overviewQuery = useAdminOverview(productCollectionsEnabled, activeOrganization?.id);
  const activityQuery = useAdminActivity(productCollectionsEnabled, activeOrganization?.id);
  const activityStatus =
    overviewQuery.status === "error" || activityQuery.status === "error"
      ? "error"
      : overviewQuery.status === "loading" || activityQuery.status === "loading"
        ? "loading"
        : overviewQuery.status === "ready" && activityQuery.status === "ready"
          ? "ready"
          : "idle";
  const activityError = overviewQuery.error ?? activityQuery.error;
  const overview: Overview = overviewQuery.overview;
  const activity = activityQuery.rows;
  const failedActivity = useMemo(
    () => activity.filter((entry) => entry.status.toLowerCase() === "failed"),
    [activity],
  );
  const runActivity = useMemo(
    () => activity.filter((entry) => entry.kind.toLowerCase().includes("run")),
    [activity],
  );
  const workspaceActivity = useMemo(
    () => activity.filter((entry) => entry.kind.toLowerCase().includes("workspace")),
    [activity],
  );

  async function refreshEverything() {
    await Promise.all([overviewQuery.refresh(), activityQuery.refresh()]);
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Activity"
      description="A route-level event feed over the current activity and overview contracts. It reflects the project, workspace, invitation, and run events the backend already emits, with a small operator lens for failures and run-heavy bursts."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/control-plane">
              <ArrowRight className="size-4 rotate-180" />
              Control plane
            </Link>
          </Button>
          <Button
            aria-label="Refresh activity"
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
      <ControlPlaneNavigation currentPath="/activity" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Activity rows currently visible to the active organization."
          label="Events"
          tone={activity.length > 0 ? "success" : statusTone(activityStatus)}
          value={String(activity.length)}
        />
        <StatCard
          detail="Active runs from the overview contract."
          label="Active runs"
          tone={overview.activeRuns > 0 ? "warning" : statusTone(activityStatus)}
          value={String(overview.activeRuns)}
        />
        <StatCard
          detail="Failed activity rows currently visible in the feed."
          label="Failed events"
          tone={failedActivity.length > 0 ? "danger" : statusTone(activityStatus)}
          value={String(failedActivity.length)}
        />
        <StatCard
          detail="Run-related rows currently visible in the feed."
          label="Run events"
          tone={runActivity.length > 0 ? "warning" : statusTone(activityStatus)}
          value={String(runActivity.length)}
        />
      </SectionGrid>

      {activityError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Activity unavailable
              </CardTitle>
              <CardDescription>{activityError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-5" />
              Recent feed
            </CardTitle>
            <CardDescription>Latest events returned by `/api/internal/activity`.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent project, run, or workspace events are visible for the active organization.
              </p>
            ) : (
              activity.map((entry) => (
                <div className="rounded-xl border p-4" key={entry.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{entry.title}</p>
                      <p className="text-sm text-muted-foreground">{entry.description}</p>
                    </div>
                    <StatusPill tone={runTone(entry.status)}>{entry.status}</StatusPill>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {entry.kind} • {formatDate(entry.occurredAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operator lens</CardTitle>
            <CardDescription>
              Quick summaries over the same overview and activity contracts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ActivityFact label="Projects" value={String(overview.projectCount)} />
            <ActivityFact label="Runs" value={String(overview.runCount)} />
            <ActivityFact label="Ready workspaces" value={String(overview.readyWorkspaces)} />
            <ActivityFact label="Workspace feed rows" value={String(workspaceActivity.length)} />
            <ActivityFact label="Pending invites" value={String(overview.pendingInvitations)} />
            <ActivityFact label="Failed runs" value={String(overview.failedRuns)} />
            {failedActivity[0] ? (
              <div className="rounded-xl border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground/80">
                  Latest failure
                </p>
                <p className="font-medium text-foreground">{failedActivity[0].title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {failedActivity[0].description}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function ActivityFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
