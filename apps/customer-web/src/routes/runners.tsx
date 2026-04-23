import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MonitorCog,
  RefreshCw,
  ShieldAlert,
  TerminalSquare,
  TriangleAlert,
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

import { buildAdminRouteHref } from "../lib/admin-origin";
import { authClient } from "../lib/auth-client";
import { CustomerRouteNavigation } from "../lib/customer-route-navigation";
import { toErrorMessage } from "../lib/customer-auth";
import {
  type LoadStatus,
  type RunnerRecord,
  formatDate,
  formatRunnerStatus,
  listRunners,
  runnerTone,
} from "../lib/internal-control-plane";

const commandClassName =
  "overflow-x-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-zinc-950 p-4 font-mono text-xs leading-6 text-zinc-50";

export const Route = createFileRoute("/runners")({
  component: RunnersRoute,
});

function RunnersRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const adminRunnersHref = buildAdminRouteHref("/runners");

  const [runnerStatus, setRunnerStatus] = useState<LoadStatus>("idle");
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [runners, setRunners] = useState<RunnerRecord[]>([]);

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setRunnerStatus("idle");
      setRunnerError(null);
      setRunners([]);
      return;
    }

    void refreshRunners();
  }, [activeOrganization?.id, session?.session.id]);

  const visibleRunners = useMemo(
    () => runners.filter((runner) => !runner.revokedAt && runner.status !== "revoked"),
    [runners],
  );
  const onlineRunners = useMemo(
    () =>
      visibleRunners.filter((runner) =>
        ["active", "online", "ready", "running"].includes(runner.status.toLowerCase()),
      ),
    [visibleRunners],
  );
  const totalCapacity = useMemo(
    () => visibleRunners.reduce((sum, runner) => sum + runner.maxConcurrency, 0),
    [visibleRunners],
  );

  async function refreshRunners() {
    setRunnerStatus("loading");
    setRunnerError(null);

    try {
      setRunners(await listRunners());
      setRunnerStatus("ready");
    } catch (caughtError) {
      setRunnerStatus("error");
      setRunnerError(
        toErrorMessage(
          caughtError,
          "Unable to load runner status. The runner API may still be in backend implementation.",
        ),
      );
      setRunners([]);
    }
  }

  return (
    <AppPage
      eyebrow="Customer workspace"
      title="Docker runners"
      description="Self-hosted runner status and install guidance for teams that want outbound-only execution near private repositories, registries, or VPN-only services."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh runners"
            onClick={() => void refreshRunners()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button asChild type="button">
            <a href={adminRunnersHref}>
              <ExternalLink className="size-4" />
              Manage in admin
            </a>
          </Button>
        </>
      }
    >
      <CustomerRouteNavigation currentPath="/runners" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Non-revoked runner records visible to this organization."
          label="Runners"
          tone={
            runnerStatus === "error" ? "danger" : visibleRunners.length > 0 ? "success" : "warning"
          }
          value={String(visibleRunners.length)}
        />
        <StatCard
          detail="Runners currently reporting online or active status."
          label="Online"
          tone={
            onlineRunners.length > 0 ? "success" : runnerStatus === "ready" ? "warning" : "neutral"
          }
          value={String(onlineRunners.length)}
        />
        <StatCard
          detail="Total max concurrency across non-revoked runners."
          label="Capacity"
          tone={totalCapacity > 0 ? "success" : "neutral"}
          value={String(totalCapacity)}
        />
        <StatCard
          detail="Runner install never requires an inbound public port for the MVP."
          label="Network"
          tone="success"
          value="outbound"
        />
      </SectionGrid>

      {runnerError ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5" />
              Runner status unavailable
            </CardTitle>
            <CardDescription>{runnerError}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              This customer surface is intentionally read-only until the backend runner endpoints
              land. Admin registration is still the expected place for creating copy-once keys.
            </p>
            <Button asChild type="button" variant="outline">
              <a href={adminRunnersHref}>Open admin runner setup</a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MonitorCog className="size-5" />
              Runner status
            </CardTitle>
            <CardDescription>
              Status should come from the control plane registration and heartbeat path: identity,
              repository scope, max concurrency, image, host, and last heartbeat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runners.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runner records are visible yet. An owner or admin can create a registration in
                admin-web, copy the API key once, then start the local Docker command.
              </p>
            ) : (
              runners.map((runner) => <RunnerStatusRow key={runner.id} runner={runner} />)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5" />
              API key model
            </CardTitle>
            <CardDescription>
              Enrollment is explicit product state. A runner calling home must not implicitly create
              itself.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Admin registration returns one opaque API key exactly once. The runner uses it to get
              short-lived sessions; job polling and status events use the session token.
            </p>
            <p>
              Revocation belongs in the control plane. A revoked key should stop receiving new work
              without requiring direct access to the user machine.
            </p>
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TerminalSquare className="size-5" />
              Install command shape
            </CardTitle>
            <CardDescription>
              The real command should be copied from the admin copy-once panel after registration.
              This placeholder shows the required Docker socket and cache volume shape.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CodeBlock>{installCommandShape}</CodeBlock>
            <CodeBlock>{stopCommand}</CodeBlock>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5" />
              Docker socket risk
            </CardTitle>
            <CardDescription>
              The runner offers private-network reachability and local execution proximity, not a
              hardened on-prem platform.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {runnerRiskCopy.map((item) => (
              <div
                className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
                key={item}
              >
                <CheckCircle2 className="mb-2 size-4 text-[var(--status-success-foreground)]" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </SectionGrid>

      {!session ? (
        <Card>
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>
              Sign in to see organization runner status. The install guide remains visible so the
              Docker socket and copy-once key semantics are clear before setup.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </AppPage>
  );
}

function RunnerStatusRow({ runner }: { runner: RunnerRecord }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{runner.displayName}</p>
            <StatusPill tone={runnerTone(runner.status, runner.revokedAt)}>
              {formatRunnerStatus(runner.status, runner.revokedAt)}
            </StatusPill>
          </div>
          <p className="text-sm text-muted-foreground">
            {runner.repositorySelectors.length > 0
              ? runner.repositorySelectors.join(", ")
              : "No repository selectors exposed"}
          </p>
        </div>
        <StatusPill tone={runner.maxConcurrency > 0 ? "success" : "warning"}>
          max {runner.maxConcurrency}
        </StatusPill>
      </div>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue label="Last heartbeat" value={formatDate(runner.lastHeartbeatAt)} />
        <KeyValue label="Current concurrency" value={String(runner.currentConcurrency ?? 0)} />
        <KeyValue label="Image version" value={runner.imageVersion ?? "unknown"} />
        <KeyValue label="Host" value={runner.hostLabel ?? "not reported"} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Allowed operations:{" "}
        {runner.allowedOperations.length > 0 ? runner.allowedOperations.join(", ") : "not exposed"}
      </p>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return <pre className={commandClassName}>{children}</pre>;
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}

const installCommandShape = `docker run -d \\
  --name firops-runner \\
  --restart unless-stopped \\
  -e FIROPS_CONTROL_PLANE_URL=https://<control-plane-host> \\
  -e FIROPS_RUNNER_API_KEY=<runner-api-key> \\
  -e FIROPS_RUNNER_NAME=<local-name> \\
  -e FIROPS_RUNNER_MAX_CONCURRENCY=1 \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v firops-runner-cache:/var/lib/firops-runner \\
  ghcr.io/firatoezcan/firops-user-docker-runner:<tag>`;

const stopCommand = `docker stop firops-runner
docker rm firops-runner
docker volume rm firops-runner-cache`;

const runnerRiskCopy = [
  "Mounting `/var/run/docker.sock` can control the Docker host and is effectively root-equivalent.",
  "The runner uses outbound traffic only; the MVP should not require an inbound public port.",
  "The API key must be shown once, stored server-side only as a verifier/hash, and never logged.",
  "Task containers must not receive the long-lived runner key or arbitrary host path mounts.",
];
