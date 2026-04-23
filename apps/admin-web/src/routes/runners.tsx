import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  KeyRound,
  MonitorCog,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

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
import { authClient } from "../lib/auth-client";
import {
  type LoadStatus,
  type RunnerRecord,
  createRunnerRegistration,
  formatDate,
  formatRunnerStatus,
  listRunners,
  revokeRunner,
  runnerTone,
  toErrorMessage,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

const inputClassName =
  "w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";
const commandClassName =
  "overflow-x-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-zinc-950 p-4 font-mono text-xs leading-6 text-zinc-50";
const defaultImageRef = "ghcr.io/firatoezcan/firops-user-docker-runner:<tag>";
const defaultControlPlaneUrl = "https://<control-plane-host>";
const defaultAllowedOperations = [
  "repo.prepare",
  "git.push",
  "github.create_pr",
  "agent.forward_message",
  "container.start",
  "container.stop",
  "artifact.upload",
];

const defaultRunnerForm = {
  allowedOperations: defaultAllowedOperations.join("\n"),
  displayName: "",
  maxConcurrency: "1",
  repositorySelectors: "",
};

type CreatedRunnerKey = {
  apiKey: string;
  controlPlaneUrl: string;
  imageRef: string;
  installCommand: string;
  runner: RunnerRecord | null;
};

export const Route = createFileRoute("/runners")({
  component: RunnersRoute,
});

function RunnersRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageRunners = activeRole === "owner" || activeRole === "admin";
  const signInHandoff = buildCustomerSignInHref(getCurrentAdminPath("/runners"), "/runners");

  const [runnerStatus, setRunnerStatus] = useState<LoadStatus>("idle");
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [runners, setRunners] = useState<RunnerRecord[]>([]);
  const [form, setForm] = useState(defaultRunnerForm);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "danger" | "success" } | null>(
    null,
  );
  const [createdKey, setCreatedKey] = useState<CreatedRunnerKey | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setRunnerStatus("idle");
      setRunnerError(null);
      setRunners([]);
      return;
    }

    void refreshRunners();
  }, [activeOrganization?.id, session?.session.id]);

  useEffect(() => {
    if (!sessionQuery.isPending && !session && typeof window !== "undefined") {
      window.location.replace(signInHandoff.href);
    }
  }, [session, sessionQuery.isPending, signInHandoff.href]);

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
          "Unable to load runners. The runner API endpoints may still be owned by the backend lane.",
        ),
      );
      setRunners([]);
    }
  }

  async function handleCreateRunner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManageRunners) {
      return;
    }

    setBusyAction("create-runner");
    setNotice(null);
    setCreatedKey(null);

    try {
      const result = await createRunnerRegistration({
        allowedOperations: parseLines(form.allowedOperations),
        displayName: form.displayName.trim(),
        maxConcurrency: Math.max(1, Number(form.maxConcurrency) || 1),
        repositoryScopes: {
          selectors: parseLines(form.repositorySelectors),
        },
      });

      if (!result.apiKey) {
        throw new Error("Runner registration succeeded without a copy-once API key.");
      }

      const controlPlaneUrl = result.controlPlaneUrl ?? deriveControlPlaneUrl();
      const imageRef = result.imageRef ?? defaultImageRef;
      const installCommand =
        result.installCommand ??
        buildInstallCommand({
          apiKey: result.apiKey,
          controlPlaneUrl,
          imageRef,
          maxConcurrency: Math.max(1, Number(form.maxConcurrency) || 1),
          runnerName: result.runner?.displayName ?? form.displayName.trim(),
        });

      setCreatedKey({
        apiKey: result.apiKey,
        controlPlaneUrl,
        imageRef,
        installCommand,
        runner: result.runner,
      });
      setForm(defaultRunnerForm);
      setNotice({
        message: "Runner registration created. Copy the API key and install command now.",
        tone: "success",
      });
      await refreshRunners();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to create runner registration."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevokeRunner(runner: RunnerRecord) {
    if (!canManageRunners) {
      return;
    }

    setBusyAction(`revoke-${runner.id}`);
    setNotice(null);

    try {
      await revokeRunner(runner.id);
      setNotice({
        message: `${runner.displayName} revoked. It should stop receiving new work after its next control-plane check.`,
        tone: "success",
      });
      await refreshRunners();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to revoke runner."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopy(value: string, target: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget(null), 1600);
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Docker runners"
      description="Register user-installed Docker runners, surface status, and hand off the copy-once API key without claiming the runner daemon or backend protocol is implemented in this repo."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/control-plane">
              <ArrowRight className="size-4 rotate-180" />
              Control plane
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
            <Link to="/queue">
              <PlugZap className="size-4" />
              Queue
            </Link>
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/runners" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Registered, non-revoked runner records from the planned `/api/internal/runners` endpoint."
          label="Available runners"
          tone={
            runnerStatus === "error" ? "danger" : visibleRunners.length > 0 ? "success" : "warning"
          }
          value={String(visibleRunners.length)}
        />
        <StatCard
          detail="Runners reporting an online/active/ready state."
          label="Online"
          tone={
            onlineRunners.length > 0 ? "success" : runnerStatus === "ready" ? "warning" : "neutral"
          }
          value={String(onlineRunners.length)}
        />
        <StatCard
          detail="Sum of max concurrency across non-revoked runners."
          label="Runner capacity"
          tone={totalCapacity > 0 ? "success" : "neutral"}
          value={String(totalCapacity)}
        />
        <StatCard
          detail="Revoked registrations remain visible so key state is auditable."
          label="Revoked"
          tone={
            runners.some((runner) => runner.revokedAt || runner.status === "revoked")
              ? "danger"
              : "neutral"
          }
          value={String(
            runners.filter((runner) => runner.revokedAt || runner.status === "revoked").length,
          )}
        />
      </SectionGrid>

      {runnerError ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5" />
              Runner API unavailable
            </CardTitle>
            <CardDescription>{runnerError}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              This page intentionally uses typed client placeholders for the planned firapps
              internal-api endpoints. Until the backend lane lands them, the UI remains buildable
              and documents the contract assumption instead of fabricating local runner state.
            </p>
            <CodeBlock>
              GET /api/internal/runners{"\n"}
              POST /api/internal/runners{"\n"}
              POST /api/internal/runners/:runnerId/revoke
            </CodeBlock>
          </CardContent>
        </Card>
      ) : null}

      {notice ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {notice.tone === "success" ? "Runner action ready" : "Runner action failed"}
            </CardTitle>
            <CardDescription>{notice.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {createdKey ? (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="size-5" />
                  Copy-once runner key
                </CardTitle>
                <CardDescription>
                  The API key is shown only in this registration response. Store it now; future
                  status views must show runner records, not the secret.
                </CardDescription>
              </div>
              <StatusPill tone="warning">copy once</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <CopyRow
              copied={copiedTarget === "api-key"}
              label="API key"
              onCopy={() => void handleCopy(createdKey.apiKey, "api-key")}
              value={createdKey.apiKey}
            />
            <CopyRow
              copied={copiedTarget === "install-command"}
              label="Install command"
              onCopy={() => void handleCopy(createdKey.installCommand, "install-command")}
              value={createdKey.installCommand}
            />
            <p className="text-xs text-muted-foreground">
              Runner: {createdKey.runner?.displayName ?? "new registration"} · Image:{" "}
              {createdKey.imageRef} · Control plane: {createdKey.controlPlaneUrl}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MonitorCog className="size-5" />
              Register runner
            </CardTitle>
            <CardDescription>
              Create an explicit control-plane registration before a local daemon receives a key.
              The key authenticates one runner identity for this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void handleCreateRunner(event)}>
              <RiskNotice />
              <LabeledField label="Display name">
                <input
                  className={inputClassName}
                  disabled={!canManageRunners}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="Firat laptop runner"
                  type="text"
                  value={form.displayName}
                />
              </LabeledField>
              <LabeledField label="Repository selectors">
                <textarea
                  className={cn(inputClassName, "min-h-20 py-3")}
                  disabled={!canManageRunners}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, repositorySelectors: event.target.value }))
                  }
                  placeholder="firatoezcan/firapps"
                  value={form.repositorySelectors}
                />
                <p className="text-xs text-muted-foreground">
                  One `owner/repo` selector per line. The backend must enforce this before leasing
                  work to the runner.
                </p>
              </LabeledField>
              <LabeledField label="Allowed operation families">
                <textarea
                  className={cn(inputClassName, "min-h-36 py-3 font-mono")}
                  disabled={!canManageRunners}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, allowedOperations: event.target.value }))
                  }
                  value={form.allowedOperations}
                />
                <p className="text-xs text-muted-foreground">
                  Structured operation allowlist only. The control plane must not send raw shell,
                  argv, arbitrary Docker args, or unallowlisted images.
                </p>
              </LabeledField>
              <LabeledField label="Maximum concurrency">
                <input
                  className={inputClassName}
                  disabled={!canManageRunners}
                  min={1}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, maxConcurrency: event.target.value }))
                  }
                  type="number"
                  value={form.maxConcurrency}
                />
              </LabeledField>
              <Button
                disabled={
                  Boolean(busyAction) ||
                  !canManageRunners ||
                  form.displayName.trim().length === 0 ||
                  parseLines(form.repositorySelectors).length === 0
                }
                type="submit"
              >
                <KeyRound className="size-4" />
                Create registration
              </Button>
              {!canManageRunners ? (
                <p className="text-xs text-muted-foreground">
                  Owner or admin role required to register or revoke runners.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="size-5" />
              Runner inventory
            </CardTitle>
            <CardDescription>
              Status is control-plane truth: registration, heartbeat recency, concurrency, image,
              host label, and revocation state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runners.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runner records are visible yet. Create a registration when the backend endpoints
                are available, then start the local Docker command from the copy-once panel.
              </p>
            ) : (
              runners.map((runner) => (
                <RunnerInventoryRow
                  busy={busyAction === `revoke-${runner.id}`}
                  canManage={canManageRunners}
                  key={runner.id}
                  onRevoke={() => void handleRevokeRunner(runner)}
                  runner={runner}
                />
              ))
            )}
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
              The command uses outbound connectivity only. Replace the placeholder key with the
              copy-once value returned by registration.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CodeBlock>
              {buildInstallCommand({
                apiKey: "<runner-api-key>",
                controlPlaneUrl: defaultControlPlaneUrl,
                imageRef: defaultImageRef,
                maxConcurrency: 1,
                runnerName: "<local-name>",
              })}
            </CodeBlock>
            <CopyRow
              copied={copiedTarget === "stop-command"}
              label="Stop and remove"
              onCopy={() => void handleCopy(stopCommand, "stop-command")}
              value={stopCommand}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5" />
              MVP guardrails
            </CardTitle>
            <CardDescription>
              The product UI must be explicit about what this is and is not before users run it on
              their own machine.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {guardrails.map((guardrail) => (
              <div
                className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
                key={guardrail}
              >
                <CheckCircle2 className="mb-2 size-4 text-[var(--status-success-foreground)]" />
                {guardrail}
              </div>
            ))}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function RunnerInventoryRow({
  busy,
  canManage,
  onRevoke,
  runner,
}: {
  busy: boolean;
  canManage: boolean;
  onRevoke: () => void;
  runner: RunnerRecord;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{runner.displayName}</p>
            <StatusPill tone={runnerTone(runner.status, runner.revokedAt)}>
              {formatRunnerStatus(runner.status, runner.revokedAt)}
            </StatusPill>
          </div>
          <p className="text-sm text-muted-foreground">
            {runner.repositorySelectors.length > 0
              ? runner.repositorySelectors.join(", ")
              : "No repository selectors exposed"}{" "}
            · max concurrency {runner.maxConcurrency}
          </p>
        </div>
        <Button
          disabled={busy || !canManage || Boolean(runner.revokedAt) || runner.status === "revoked"}
          onClick={onRevoke}
          size="sm"
          type="button"
          variant="outline"
        >
          <Trash2 className="size-4" />
          Revoke
        </Button>
      </div>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue label="Last heartbeat" value={formatDate(runner.lastHeartbeatAt)} />
        <KeyValue label="Current concurrency" value={String(runner.currentConcurrency ?? 0)} />
        <KeyValue label="Image version" value={runner.imageVersion ?? "unknown"} />
        <KeyValue label="Host" value={runner.hostLabel ?? "not reported"} />
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        Allowed operations:{" "}
        {runner.allowedOperations.length > 0 ? runner.allowedOperations.join(", ") : "not exposed"}
      </div>
    </div>
  );
}

function RiskNotice() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100">
      The install command mounts `/var/run/docker.sock`, which can control the local Docker host.
      Use this only on a host where that root-equivalent risk is acceptable.
    </div>
  );
}

function LabeledField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="space-y-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CopyRow({
  copied,
  label,
  onCopy,
  value,
}: {
  copied: boolean;
  label: string;
  onCopy: () => void;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <Button onClick={onCopy} size="sm" type="button" variant="outline">
          <Copy className="size-4" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <CodeBlock>{value}</CodeBlock>
    </div>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
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

function parseLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function deriveControlPlaneUrl() {
  if (typeof window === "undefined") {
    return defaultControlPlaneUrl;
  }

  return window.location.origin;
}

function buildInstallCommand({
  apiKey,
  controlPlaneUrl,
  imageRef,
  maxConcurrency,
  runnerName,
}: {
  apiKey: string;
  controlPlaneUrl: string;
  imageRef: string;
  maxConcurrency: number;
  runnerName: string;
}) {
  return `docker run -d \\
  --name firops-runner \\
  --restart unless-stopped \\
  -e FIROPS_CONTROL_PLANE_URL=${controlPlaneUrl} \\
  -e FIROPS_RUNNER_API_KEY=${apiKey} \\
  -e FIROPS_RUNNER_NAME=${runnerName || "<local-name>"} \\
  -e FIROPS_RUNNER_MAX_CONCURRENCY=${maxConcurrency} \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v firops-runner-cache:/var/lib/firops-runner \\
  ${imageRef}`;
}

const stopCommand = `docker stop firops-runner
docker rm firops-runner
docker volume rm firops-runner-cache`;

const guardrails = [
  "The long-lived API key must never be logged or passed into child task containers.",
  "The runner gets work through structured leases, not shell strings or arbitrary Docker CLI args.",
  "Revocation is a control-plane action: revoked keys must stop receiving new work.",
  "Runner status depends on outbound heartbeat/session traffic; no inbound public port is required.",
];
