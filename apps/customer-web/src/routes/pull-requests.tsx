import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useEffect, useState } from "react";

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
  refreshCustomerMemberRunsSnapshot,
  useCustomerMemberRunsCollection,
  type MemberRunScope,
} from "../lib/customer-product-data";
import { toErrorMessage } from "../lib/customer-auth";
import {
  type LoadStatus,
  type RunRecord,
  formatDate,
  getRunPullRequestUrl,
  getRunStep,
  runTone,
  statusTone,
} from "../lib/internal-control-plane";

export const Route = createFileRoute("/pull-requests")({
  component: PullRequestsRoute,
});

function PullRequestsRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;

  const [runStatus, setRunStatus] = useState<LoadStatus>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [scope, setScope] = useState<MemberRunScope | null>(null);
  const dataEnabled = Boolean(session && activeOrganization?.id);
  const memberRunCollection = useCustomerMemberRunsCollection(dataEnabled);
  const organizationRuns = dataEnabled ? memberRunCollection.organizationRuns : [];
  const runs = dataEnabled ? memberRunCollection.runs : [];

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setRunStatus("idle");
      setRunError(null);
      setScope(null);
      void clearCustomerMemberRunsSnapshot().catch(() => undefined);
      return;
    }

    void refreshRuns();
  }, [activeOrganization?.id, session?.session.id]);

  const prRows = useMemo(
    () =>
      runs
        .map((run) => ({
          openPullRequestStep: getRunStep(run, "open_pull_request"),
          prUrl: getRunPullRequestUrl(run),
          run,
        }))
        .filter((row) => row.prUrl),
    [runs],
  );
  const branchOnlyRows = useMemo(
    () =>
      runs
        .map((run) => ({
          openPullRequestStep: getRunStep(run, "open_pull_request"),
          prUrl: getRunPullRequestUrl(run),
          run,
        }))
        .filter((row) => !row.prUrl && row.run.branchName),
    [runs],
  );
  const latestAttentionRow = branchOnlyRows[0] ?? null;

  async function refreshRuns() {
    if (!session) {
      return;
    }

    setRunStatus("loading");
    setRunError(null);

    try {
      const memberRunsResult = await refreshCustomerMemberRunsSnapshot({
        email: session.user.email,
        userId: session.user.id,
      });

      setScope(memberRunsResult.scope);
      setRunStatus("ready");
    } catch (caughtError) {
      setRunStatus("error");
      setRunError(toErrorMessage(caughtError, "Unable to load pull request visibility."));
      setScope(null);
      await clearCustomerMemberRunsSnapshot().catch(() => undefined);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="My pull requests"
      description="A member-focused pull request route over the current run records. It keeps PR links and branch evidence tied to your signed-in member through the explicit backend filter `requestedBy=self`."
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
            onClick={() => void refreshRuns()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <CustomerRouteNavigation currentPath="/pull-requests" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Visible member-scoped runs with a direct PR URL or PR artifact."
          label="PR links"
          tone={prRows.length > 0 ? "success" : statusTone(runStatus)}
          value={String(prRows.length)}
        />
        <StatCard
          detail="Visible member-scoped runs that exposed a branch but no PR URL."
          label="Branch only"
          tone={branchOnlyRows.length > 0 ? "warning" : statusTone(runStatus)}
          value={String(branchOnlyRows.length)}
        />
        <StatCard
          detail="Completed runs in the current member view."
          label="Completed runs"
          tone={runs.some((run) => run.status === "completed") ? "success" : statusTone(runStatus)}
          value={String(runs.filter((run) => run.status === "completed").length)}
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
                Pull request visibility unavailable
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
                "Set an active organization to load the member-scoped pull request surface."}
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
              The fastest PR follow-up available from your member-scoped surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {prRows.length === 0 && !latestAttentionRow ? (
              <p>
                No PR evidence is visible yet. Keep this page as the follow-up surface once a run
                exposes branch or PR output.
              </p>
            ) : prRows.length > 0 ? (
              <>
                <p>
                  <span className="font-medium text-foreground">{prRows[0]?.run.title}</span>{" "}
                  already exposes a PR link.
                </p>
                <p>{getMemberPullRequestNextAction(prRows[0]!.run)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" type="button">
                    <a href={prRows[0]!.prUrl ?? undefined} rel="noreferrer" target="_blank">
                      <ExternalLink className="size-4" />
                      Open PR
                    </a>
                  </Button>
                  <Button asChild size="sm" type="button" variant="outline">
                    <Link params={{ runId: prRows[0]!.run.id }} to="/runs/$runId">
                      Open run
                    </Link>
                  </Button>
                </div>
              </>
            ) : latestAttentionRow ? (
              <>
                <p>
                  <span className="font-medium text-foreground">
                    {latestAttentionRow.run.title}
                  </span>{" "}
                  only has branch evidence so far.
                </p>
                <p>{getMemberPullRequestNextAction(latestAttentionRow.run)}</p>
                <Button asChild size="sm" type="button">
                  <Link params={{ runId: latestAttentionRow.run.id }} to="/runs/$runId">
                    Open branch-only run
                  </Link>
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Route contract</CardTitle>
            <CardDescription>
              This page derives PR visibility from the member-scoped run surface instead of showing
              every PR in the active organization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              That keeps the customer route aligned with "my work" rather than the broader
              organization queue.
            </p>
            <p>
              Branch-only rows stay visible when the backend exposed branch evidence but not a PR
              URL yet.
            </p>
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitPullRequest className="size-5" />
              Your pull requests
            </CardTitle>
            <CardDescription>
              PR links and step evidence attached to the current member-scoped run records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {prRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No member-scoped run exposes a pull request URL right now.
              </p>
            ) : (
              prRows.map((row) => (
                <div className="rounded-xl border p-4" key={row.run.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{row.run.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {row.run.projectName ?? "Unknown project"} •{" "}
                        {row.run.branchName ?? "No branch exposed"}
                      </p>
                    </div>
                    <StatusPill tone={runTone(row.run.status)}>{row.run.status}</StatusPill>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <Button asChild size="sm" type="button" variant="outline">
                      <a href={row.prUrl ?? undefined} rel="noreferrer" target="_blank">
                        <ExternalLink className="size-4" />
                        Open PR
                      </a>
                    </Button>
                    <Button asChild size="sm" type="button" variant="outline">
                      <Link params={{ runId: row.run.id }} to="/runs/$runId">
                        Open run
                      </Link>
                    </Button>
                    <span>Requested {formatDate(row.run.createdAt)}</span>
                    <span>Step: {row.openPullRequestStep?.status ?? "No PR step record"}</span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {getMemberPullRequestNextAction(row.run)}
                  </p>
                </div>
              ))
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
              Member-scoped branch information without a matching PR URL yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {branchOnlyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No branch-only member runs are visible right now.
              </p>
            ) : (
              branchOnlyRows.map((row) => (
                <div className="rounded-xl border p-3" key={row.run.id}>
                  <p className="font-medium">{row.run.title}</p>
                  <p className="text-sm text-muted-foreground">{row.run.branchName}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {getMemberPullRequestNextAction(row.run)}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                    {row.openPullRequestStep?.status ?? "No PR step record"}
                  </p>
                  <div className="mt-3">
                    <Button asChild size="sm" type="button" variant="outline">
                      <Link params={{ runId: row.run.id }} to="/runs/$runId">
                        Open run
                      </Link>
                    </Button>
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

function getMemberPullRequestNextAction(run: RunRecord) {
  if (getRunPullRequestUrl(run)) {
    return "PR evidence exists. Open it to review the current diff and comments.";
  }

  if (run.branchName) {
    return "Branch evidence exists without a PR URL. Open the run to inspect the latest output and status.";
  }

  if (run.failureMessage) {
    return "The run failed before a clean PR handoff. Use the run detail for the visible failure context.";
  }

  return "Use the run detail to inspect whether PR output is still in progress.";
}
