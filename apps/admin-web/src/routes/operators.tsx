import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  RefreshCw,
  ServerCog,
  ShieldUser,
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

import { buildCustomerSignInHref, getCurrentAdminPath } from "../lib/admin-sign-in-handoff";
import { authClient } from "../lib/auth-client";
import {
  type LoadStatus,
  formatDate,
  requestInternalApi,
  runTone,
  tenantTone,
  toErrorMessage,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

type OperatorService = {
  detail: string;
  name: string;
  status: string;
};

type OperatorOrganization = {
  activeRuns: number;
  failedRuns: number;
  id: string;
  memberCount: number;
  name: string;
  pendingInvitations: number;
  projectCount: number;
  readyWorkspaces: number;
  slug: string;
};

type OperatorQueueItem = {
  id: string;
  projectId: string;
  source: string;
  status: string;
  title: string;
  updatedAt?: string | null;
};

type OperatorActivity = {
  description: string;
  id: string;
  kind: string;
  occurredAt?: string | null;
  organizationId?: string | null;
  runId?: string | null;
  status: string;
  tenantId?: string | null;
  title: string;
  workspaceRecordId?: string | null;
};

type OperatorFailure = {
  failureMessage?: string | null;
  id: string;
  title: string;
  updatedAt?: string | null;
};

type OperatorSummary = {
  failedRuns: number;
  organizations: number;
  projects: number;
  readyWorkspaces: number;
  runs: number;
};

type OperatorRuntimeNode = {
  name: string;
  ready: boolean;
  schedulable: boolean;
  workspaceIdeReady: boolean;
};

type OperatorRuntimeWorkspaceFailure = {
  workspaceId: string;
  phase?: string | null;
  failureReason?: string | null;
  failureMessage?: string | null;
};

type OperatorRuntimeWorkspaceSummary = {
  failed: number;
  provisioning: number;
  ready: number;
  readyWorkspaceIdeNodes: number;
  total: number;
  workspaceIdeReadyNodes: number;
};

type OperatorRuntimeSnapshot = {
  failedWorkspaces: OperatorRuntimeWorkspaceFailure[];
  generatedAt?: string | null;
  nodes: OperatorRuntimeNode[];
  services: OperatorService[];
  workspaceSummary: OperatorRuntimeWorkspaceSummary;
};

type OperatorSnapshot = {
  generatedAt?: string | null;
  organizations: OperatorOrganization[];
  queue: OperatorQueueItem[];
  recentActivity: OperatorActivity[];
  recentFailures: OperatorFailure[];
  runtime: OperatorRuntimeSnapshot | null;
  services: OperatorService[];
  summary: OperatorSummary;
};

const emptySnapshot: OperatorSnapshot = {
  generatedAt: null,
  organizations: [],
  queue: [],
  recentActivity: [],
  recentFailures: [],
  runtime: null,
  services: [],
  summary: {
    failedRuns: 0,
    organizations: 0,
    projects: 0,
    readyWorkspaces: 0,
    runs: 0,
  },
};

export const Route = createFileRoute("/operators")({
  component: OperatorsRoute,
});

function OperatorsRoute() {
  const sessionQuery = authClient.useSession();

  const session = sessionQuery.data;
  const signInHandoff = buildCustomerSignInHref(getCurrentAdminPath("/operators"), "/operators");

  const [operatorStatus, setOperatorStatus] = useState<LoadStatus>("idle");
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OperatorSnapshot>(emptySnapshot);

  useEffect(() => {
    if (!session) {
      setOperatorStatus("idle");
      setOperatorError(null);
      setSnapshot(emptySnapshot);
      return;
    }

    void refreshOperatorView();
  }, [session?.session.id]);

  useEffect(() => {
    if (!sessionQuery.isPending && !session && typeof window !== "undefined") {
      window.location.replace(signInHandoff.href);
    }
  }, [session, sessionQuery.isPending, signInHandoff.href]);

  const healthyServices = useMemo(
    () => snapshot.services.filter((service) => service.status === "healthy"),
    [snapshot.services],
  );

  async function refreshOperatorView() {
    setOperatorStatus("loading");
    setOperatorError(null);

    try {
      const payload = (await requestInternalApi("/operator")) as unknown;

      setSnapshot(normalizeOperatorSnapshot(payload));
      setOperatorStatus("ready");
    } catch (caughtError) {
      setOperatorStatus("error");
      setOperatorError(toErrorMessage(caughtError, "Unable to load founder operator state."));
      setSnapshot(emptySnapshot);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Operator view"
      description="Founder-level cross-org runtime visibility over `/api/internal/operator`: service health, queue pressure, recent failures, and organization rollups."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/control-plane">
              <ArrowRight className="size-4 rotate-180" />
              Control plane
            </Link>
          </Button>
          <Button
            aria-label="Refresh operators"
            onClick={() => void refreshOperatorView()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/operators" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Organizations visible in the founder/operator snapshot."
          label="Organizations"
          tone={operatorStatus === "error" ? "danger" : "success"}
          value={String(snapshot.summary.organizations)}
        />
        <StatCard
          detail="Currently healthy platform-facing services."
          label="Healthy services"
          tone={
            healthyServices.length > 0
              ? "success"
              : operatorStatus === "error"
                ? "danger"
                : "warning"
          }
          value={String(healthyServices.length)}
        />
        <StatCard
          detail="Current failed-run count across the operator snapshot."
          label="Failed runs"
          tone={
            snapshot.summary.failedRuns > 0
              ? "danger"
              : operatorStatus === "ready"
                ? "success"
                : "warning"
          }
          value={String(snapshot.summary.failedRuns)}
        />
        <StatCard
          detail="Ready devboxes/workspaces visible across organizations."
          label="Ready workspaces"
          tone={
            snapshot.summary.readyWorkspaces > 0
              ? "success"
              : operatorStatus === "error"
                ? "danger"
                : "neutral"
          }
          value={String(snapshot.summary.readyWorkspaces)}
        />
      </SectionGrid>

      {operatorError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Operator data unavailable
              </CardTitle>
              <CardDescription>{operatorError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ServerCog className="size-5" />
              Service health
            </CardTitle>
            <CardDescription>
              Product-facing runtime dependencies surfaced by the control plane.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No service health rows are visible yet.
              </p>
            ) : (
              snapshot.services.map((service) => (
                <div className="rounded-xl border p-3" key={service.name}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{service.name}</p>
                      <p className="text-sm text-muted-foreground">{service.detail}</p>
                    </div>
                    <StatusPill tone={tenantTone(service.status)}>{service.status}</StatusPill>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldUser className="size-5" />
              Cross-org health
            </CardTitle>
            <CardDescription>
              Organization-level workload and failure rollups from the founder snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organizations are visible yet.</p>
            ) : (
              snapshot.organizations.map((organization) => (
                <div className="rounded-xl border p-3" key={organization.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{organization.name}</p>
                      <p className="text-sm text-muted-foreground">{organization.slug}</p>
                    </div>
                    <StatusPill
                      tone={
                        organization.failedRuns > 0
                          ? "danger"
                          : organization.activeRuns > 0
                            ? "warning"
                            : "success"
                      }
                    >
                      {organization.failedRuns > 0
                        ? "attention"
                        : organization.activeRuns > 0
                          ? "active"
                          : "stable"}
                    </StatusPill>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                    <OperatorField label="Projects" value={String(organization.projectCount)} />
                    <OperatorField label="Members" value={String(organization.memberCount)} />
                    <OperatorField label="Active runs" value={String(organization.activeRuns)} />
                    <OperatorField label="Failed runs" value={String(organization.failedRuns)} />
                    <OperatorField
                      label="Pending invites"
                      value={String(organization.pendingInvitations)}
                    />
                    <OperatorField
                      label="Ready workspaces"
                      value={String(organization.readyWorkspaces)}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-5" />
              Recent failures
            </CardTitle>
            <CardDescription>
              Founder-facing run failures that would otherwise stay in shell output.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.recentFailures.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent failures are visible.</p>
            ) : (
              snapshot.recentFailures.map((failure) => (
                <div className="rounded-xl border p-3" key={failure.id}>
                  <p className="font-medium">{failure.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {failure.failureMessage ?? "No failure message recorded."}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                    {formatDate(failure.updatedAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Queue snapshot</CardTitle>
            <CardDescription>
              Cross-org queue rows from the founder/operator endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">No queue items are visible right now.</p>
            ) : (
              snapshot.queue.map((item) => (
                <div className="rounded-xl border p-3" key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        Project {item.projectId} • {item.source}
                      </p>
                    </div>
                    <StatusPill tone={runTone(item.status)}>{item.status}</StatusPill>
                  </div>
                  <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                    {formatDate(item.updatedAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Product events now exposed directly through the founder route.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity is visible yet.</p>
            ) : (
              snapshot.recentActivity.slice(0, 10).map((entry) => (
                <div className="rounded-xl border p-3" key={entry.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{entry.title}</p>
                      <p className="text-sm text-muted-foreground">{entry.description}</p>
                    </div>
                    <StatusPill tone={runTone(entry.status)}>{entry.status}</StatusPill>
                  </div>
                  <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                    {entry.kind} • {formatDate(entry.occurredAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Sandbox runtime</CardTitle>
            <CardDescription>
              Raw provisioner runtime truth now forwarded through `/api/internal/operator`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!snapshot.runtime ? (
              <p className="text-sm text-muted-foreground">
                No sandbox runtime snapshot is available right now.
              </p>
            ) : (
              <>
                <OperatorField
                  label="Ready workspaces"
                  value={String(snapshot.runtime.workspaceSummary.ready)}
                />
                <OperatorField
                  label="Provisioning"
                  value={String(snapshot.runtime.workspaceSummary.provisioning)}
                />
                <OperatorField
                  label="Failed workspaces"
                  value={String(snapshot.runtime.workspaceSummary.failed)}
                />
                <OperatorField
                  label="Ready sandbox nodes"
                  value={`${snapshot.runtime.workspaceSummary.readyWorkspaceIdeNodes}/${snapshot.runtime.workspaceSummary.workspaceIdeReadyNodes}`}
                />
                <p className="text-xs uppercase tracking-wide text-muted-foreground/80">
                  {formatDate(snapshot.runtime.generatedAt)}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sandbox nodes</CardTitle>
            <CardDescription>
              Workspace-capable sandbox nodes from the provisioner runtime bridge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!snapshot.runtime || snapshot.runtime.nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No workspace-capable sandbox nodes were reported.
              </p>
            ) : (
              snapshot.runtime.nodes.map((node) => (
                <div className="rounded-xl border p-3" key={node.name}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{node.name}</p>
                      <p className="text-sm text-muted-foreground">
                        workspace-ide-ready={String(node.workspaceIdeReady)}
                      </p>
                    </div>
                    <StatusPill
                      tone={
                        node.ready && node.schedulable
                          ? "success"
                          : node.ready
                            ? "warning"
                            : "danger"
                      }
                    >
                      {node.ready && node.schedulable ? "ready" : node.ready ? "cordoned" : "down"}
                    </StatusPill>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Failed workspaces</CardTitle>
            <CardDescription>
              SandboxWorkspace failures surfaced directly from the provisioner runtime snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!snapshot.runtime || snapshot.runtime.failedWorkspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No failed sandbox workspaces are visible right now.
              </p>
            ) : (
              snapshot.runtime.failedWorkspaces.map((workspace) => (
                <div className="rounded-xl border p-3" key={workspace.workspaceId}>
                  <p className="font-medium">{workspace.workspaceId}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {workspace.failureMessage ??
                      workspace.failureReason ??
                      "No failure detail returned."}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground/80">
                    {workspace.phase ?? "unknown phase"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function OperatorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}

function normalizeOperatorSnapshot(entry: unknown): OperatorSnapshot {
  return {
    generatedAt: readString(entry, "generatedAt") ?? readString(entry, "generated_at") ?? null,
    organizations: normalizeOperatorOrganizations(readArray(entry, "organizations")),
    queue: normalizeQueueItems(readArray(entry, "queue")),
    recentActivity: normalizeRecentActivity(readArray(entry, "recentActivity")),
    recentFailures: normalizeRecentFailures(readArray(entry, "recentFailures")),
    runtime: normalizeRuntimeSnapshot(readObject(entry, "runtime")),
    services: normalizeServices(readArray(entry, "services")),
    summary: normalizeSummary(readObject(entry, "summary")),
  };
}

function normalizeRuntimeSnapshot(
  entry: Record<string, unknown> | null,
): OperatorRuntimeSnapshot | null {
  if (!entry) {
    return null;
  }

  return {
    failedWorkspaces: normalizeFailedWorkspaces(readArray(entry, "failedWorkspaces")),
    generatedAt: readString(entry, "generatedAt") ?? readString(entry, "generated_at") ?? null,
    nodes: normalizeRuntimeNodes(readArray(entry, "nodes")),
    services: normalizeServices(readArray(entry, "services")),
    workspaceSummary: normalizeRuntimeWorkspaceSummary(readObject(entry, "workspaceSummary")),
  };
}

function normalizeServices(entries: unknown[] | null): OperatorService[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    detail: readString(entry, "detail") ?? "",
    name: readString(entry, "name") ?? `service-${index}`,
    status: readString(entry, "status") ?? "unknown",
  }));
}

function normalizeOperatorOrganizations(entries: unknown[] | null): OperatorOrganization[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    activeRuns: readNumber(entry, "activeRuns") ?? readNumber(entry, "active_runs") ?? 0,
    failedRuns: readNumber(entry, "failedRuns") ?? readNumber(entry, "failed_runs") ?? 0,
    id: readString(entry, "id") ?? `org-${index}`,
    memberCount: readNumber(entry, "memberCount") ?? readNumber(entry, "member_count") ?? 0,
    name: readString(entry, "name") ?? `Organization ${index + 1}`,
    pendingInvitations:
      readNumber(entry, "pendingInvitations") ?? readNumber(entry, "pending_invitations") ?? 0,
    projectCount: readNumber(entry, "projectCount") ?? readNumber(entry, "project_count") ?? 0,
    readyWorkspaces:
      readNumber(entry, "readyWorkspaces") ?? readNumber(entry, "ready_workspaces") ?? 0,
    slug: readString(entry, "slug") ?? `organization-${index + 1}`,
  }));
}

function normalizeQueueItems(entries: unknown[] | null): OperatorQueueItem[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    id: readString(entry, "id") ?? `queue-${index}`,
    projectId: readString(entry, "projectId") ?? readString(entry, "project_id") ?? "unknown",
    source: readString(entry, "source") ?? "manual",
    status: readString(entry, "status") ?? "unknown",
    title: readString(entry, "title") ?? `Queue item ${index + 1}`,
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  }));
}

function normalizeRecentActivity(entries: unknown[] | null): OperatorActivity[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    description: readString(entry, "description") ?? "",
    id: readString(entry, "id") ?? `activity-${index}`,
    kind: readString(entry, "kind") ?? "event",
    occurredAt: readString(entry, "occurredAt") ?? readString(entry, "occurred_at") ?? null,
    organizationId:
      readString(entry, "organizationId") ?? readString(entry, "organization_id") ?? null,
    runId: readString(entry, "runId") ?? readString(entry, "run_id") ?? null,
    status: readString(entry, "status") ?? "completed",
    tenantId: readString(entry, "tenantId") ?? readString(entry, "tenant_id") ?? null,
    title: readString(entry, "title") ?? `Activity ${index + 1}`,
    workspaceRecordId:
      readString(entry, "workspaceRecordId") ?? readString(entry, "workspace_record_id") ?? null,
  }));
}

function normalizeRecentFailures(entries: unknown[] | null): OperatorFailure[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    failureMessage:
      readString(entry, "failureMessage") ?? readString(entry, "failure_message") ?? null,
    id: readString(entry, "id") ?? `failure-${index}`,
    title: readString(entry, "title") ?? `Failure ${index + 1}`,
    updatedAt: readString(entry, "updatedAt") ?? readString(entry, "updated_at") ?? null,
  }));
}

function normalizeRuntimeNodes(entries: unknown[] | null): OperatorRuntimeNode[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    name: readString(entry, "name") ?? `node-${index}`,
    ready: readBoolean(entry, "ready") ?? false,
    schedulable: readBoolean(entry, "schedulable") ?? false,
    workspaceIdeReady:
      readBoolean(entry, "workspaceIdeReady") ?? readBoolean(entry, "workspace_ide_ready") ?? false,
  }));
}

function normalizeFailedWorkspaces(entries: unknown[] | null): OperatorRuntimeWorkspaceFailure[] {
  if (!entries) {
    return [];
  }

  return entries.map((entry, index) => ({
    failureMessage:
      readString(entry, "failureMessage") ?? readString(entry, "failure_message") ?? null,
    failureReason:
      readString(entry, "failureReason") ?? readString(entry, "failure_reason") ?? null,
    phase: readString(entry, "phase") ?? null,
    workspaceId:
      readString(entry, "workspaceId") ?? readString(entry, "workspace_id") ?? `workspace-${index}`,
  }));
}

function normalizeRuntimeWorkspaceSummary(
  entry: Record<string, unknown> | null,
): OperatorRuntimeWorkspaceSummary {
  return {
    failed: readNumber(entry, "failed") ?? 0,
    provisioning: readNumber(entry, "provisioning") ?? 0,
    ready: readNumber(entry, "ready") ?? 0,
    readyWorkspaceIdeNodes:
      readNumber(entry, "readyWorkspaceIdeNodes") ??
      readNumber(entry, "ready_workspace_ide_nodes") ??
      0,
    total: readNumber(entry, "total") ?? 0,
    workspaceIdeReadyNodes:
      readNumber(entry, "workspaceIdeReadyNodes") ??
      readNumber(entry, "workspace_ide_ready_nodes") ??
      0,
  };
}

function normalizeSummary(entry: unknown): OperatorSummary {
  return {
    failedRuns: readNumber(entry, "failedRuns") ?? readNumber(entry, "failed_runs") ?? 0,
    organizations: readNumber(entry, "organizations") ?? 0,
    projects: readNumber(entry, "projects") ?? 0,
    readyWorkspaces:
      readNumber(entry, "readyWorkspaces") ?? readNumber(entry, "ready_workspaces") ?? 0,
    runs: readNumber(entry, "runs") ?? 0,
  };
}

function readString(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function readNumber(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readBoolean(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "boolean" ? candidate : null;
}

function readArray(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return Array.isArray(candidate) ? candidate : null;
}

function readObject(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = (entry as Record<string, unknown>)[key];

  return typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown>)
    : null;
}
