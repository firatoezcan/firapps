import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CreditCard, RefreshCw, Receipt, Save, TriangleAlert } from "lucide-react";
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

import {
  updateAdminProject,
  useAdminProjects,
  useAdminUsage,
  type UsageProject,
  type UsageSummary,
} from "../lib/admin-product-data";
import { authClient } from "../lib/auth-client";
import {
  type Project,
  formatCount,
  formatDate,
  tenantTone,
  toErrorMessage,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

type BillingDraft = {
  billingEmail: string;
  billingPlan: string;
  billingReference: string;
  billingStatus: string;
  seatLimit: string;
};

export const Route = createFileRoute("/billing")({
  component: BillingRoute,
});

function BillingRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageBilling = activeRole === "owner" || activeRole === "admin";

  const productCollectionsEnabled = Boolean(session && activeOrganization?.id);
  const projectsQuery = useAdminProjects(productCollectionsEnabled, activeOrganization?.id);
  const usageQuery = useAdminUsage(productCollectionsEnabled, activeOrganization?.id);
  const projectStatus = projectsQuery.status;
  const projectError = projectsQuery.error;
  const projects = projectsQuery.rows;
  const usageStatus = usageQuery.status;
  const usageError = usageQuery.error;
  const usageProjects = usageQuery.projects;
  const usageSummary: UsageSummary = usageQuery.summary;
  const [drafts, setDrafts] = useState<Record<string, BillingDraft>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "danger" | "success" } | null>(
    null,
  );

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        projects.map((project) => [
          project.id,
          {
            billingEmail: project.billingEmail ?? "",
            billingPlan: project.billingPlan ?? "",
            billingReference: project.billingReference ?? "",
            billingStatus: project.billingStatus ?? project.status ?? "",
            seatLimit: project.seatLimit != null ? String(project.seatLimit) : "",
          },
        ]),
      ),
    );
  }, [projects]);

  const missingBillingEmail = useMemo(
    () => usageProjects.filter((project) => !project.billingEmail),
    [usageProjects],
  );
  const missingBillingReference = useMemo(
    () => usageProjects.filter((project) => !project.billingReference),
    [usageProjects],
  );
  const mergedProjects = useMemo(() => {
    const usageById = new Map(usageProjects.map((project) => [project.id, project]));

    return projects.map((project) => ({
      project,
      usage: usageById.get(project.id) ?? null,
    }));
  }, [projects, usageProjects]);

  async function refreshEverything() {
    await Promise.all([projectsQuery.refresh(), usageQuery.refresh()]);
  }

  async function handleSaveBilling(project: Project) {
    if (!canManageBilling) {
      return;
    }

    const draft = drafts[project.id];

    if (!draft) {
      return;
    }

    const seatLimit = parseSeatLimit(draft.seatLimit);

    setBusyAction(`save-${project.id}`);
    setNotice(null);

    try {
      await updateAdminProject(project.id, {
        billingEmail: emptyToNull(draft.billingEmail),
        billingPlan: emptyToNull(draft.billingPlan),
        billingReference: emptyToNull(draft.billingReference),
        billingStatus: emptyToNull(draft.billingStatus),
        seatLimit,
      });

      setNotice({
        message: `Billing placeholders saved for ${project.name}.`,
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to update billing placeholders."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function resetDraft(project: Project) {
    setDrafts((current) => ({
      ...current,
      [project.id]: {
        billingEmail: project.billingEmail ?? "",
        billingPlan: project.billingPlan ?? "",
        billingReference: project.billingReference ?? "",
        billingStatus: project.billingStatus ?? project.status ?? "",
        seatLimit: project.seatLimit != null ? String(project.seatLimit) : "",
      },
    }));
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Billing inventory"
      description="Billing placeholders are now tied to the real `/api/internal/usage` rollup: compute minutes, seat counts, open PR load, and per-project plan metadata."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/control-plane">
              <ArrowRight className="size-4 rotate-180" />
              Control plane
            </Link>
          </Button>
          <Button
            aria-label="Refresh billing"
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
      <ControlPlaneNavigation currentPath="/billing" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Projects visible to the active organization."
          label="Projects"
          tone={projectStatus === "error" ? "danger" : "success"}
          value={String(projects.length)}
        />
        <StatCard
          detail="Usage rollup tied to current run compute time."
          label="Compute minutes"
          tone={
            usageStatus === "error"
              ? "danger"
              : usageSummary.computeMinutes > 0
                ? "success"
                : "warning"
          }
          value={String(usageSummary.computeMinutes)}
        />
        <StatCard
          detail="Current active-member count from the usage summary."
          label="Active seats"
          tone={
            usageStatus === "error"
              ? "danger"
              : usageSummary.activeSeats > 0
                ? "success"
                : "neutral"
          }
          value={String(usageSummary.activeSeats)}
        />
        <StatCard
          detail="Open PR load tied to visible runs."
          label="Open PRs"
          tone={
            usageStatus === "error"
              ? "danger"
              : usageSummary.openPullRequests > 0
                ? "warning"
                : "neutral"
          }
          value={String(usageSummary.openPullRequests)}
        />
      </SectionGrid>

      {projectError || usageError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Billing data unavailable
              </CardTitle>
              <CardDescription>{projectError ?? usageError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      {notice ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle>
                {notice.tone === "success" ? "Billing updated" : "Billing update failed"}
              </CardTitle>
              <CardDescription>{notice.message}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-5" />
              Billing roster
            </CardTitle>
            <CardDescription>
              Per-project plan, usage, and placeholder account metadata from `/projects` plus
              `/usage`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {mergedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No project billing records are visible for the active organization.
              </p>
            ) : (
              mergedProjects.map(({ project, usage }) => {
                const draft = drafts[project.id] ?? {
                  billingEmail: project.billingEmail ?? "",
                  billingPlan: project.billingPlan ?? "",
                  billingReference: project.billingReference ?? "",
                  billingStatus: project.billingStatus ?? project.status ?? "",
                  seatLimit: project.seatLimit != null ? String(project.seatLimit) : "",
                };
                const billingStatus =
                  draft.billingStatus ||
                  usage?.billingStatus ||
                  project.billingStatus ||
                  project.status;
                const seatLimitError = validateSeatLimit(draft.seatLimit);
                const isDirty = billingDraftChanged(project, draft);

                return (
                  <div className="rounded-xl border p-4" key={project.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {draft.billingPlan ||
                            usage?.billingPlan ||
                            project.billingPlan ||
                            "No plan set"}{" "}
                          • {project.repoOwner ?? "unknown-owner"}/
                          {project.repoName ?? "unknown-repo"}
                        </p>
                      </div>
                      <StatusPill tone={tenantTone(billingStatus)}>{billingStatus}</StatusPill>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Editable billing placeholders</p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <LabeledField label="Billing email">
                            <input
                              className={inputClassName}
                              disabled={!canManageBilling}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [project.id]: {
                                    ...draft,
                                    billingEmail: event.target.value,
                                  },
                                }))
                              }
                              type="email"
                              value={draft.billingEmail}
                            />
                          </LabeledField>
                          <LabeledField label="Billing plan">
                            <input
                              className={inputClassName}
                              disabled={!canManageBilling}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [project.id]: {
                                    ...draft,
                                    billingPlan: event.target.value,
                                  },
                                }))
                              }
                              value={draft.billingPlan}
                            />
                          </LabeledField>
                          <LabeledField label="Billing reference">
                            <input
                              className={inputClassName}
                              disabled={!canManageBilling}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [project.id]: {
                                    ...draft,
                                    billingReference: event.target.value,
                                  },
                                }))
                              }
                              value={draft.billingReference}
                            />
                          </LabeledField>
                          <LabeledField label="Billing status">
                            <input
                              className={inputClassName}
                              disabled={!canManageBilling}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [project.id]: {
                                    ...draft,
                                    billingStatus: event.target.value,
                                  },
                                }))
                              }
                              value={draft.billingStatus}
                            />
                          </LabeledField>
                          <LabeledField label="Seat limit">
                            <div className="space-y-2">
                              <input
                                className={inputClassName}
                                disabled={!canManageBilling}
                                inputMode="numeric"
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [project.id]: {
                                      ...draft,
                                      seatLimit: event.target.value,
                                    },
                                  }))
                                }
                                value={draft.seatLimit}
                              />
                              {seatLimitError ? (
                                <p className="text-xs text-red-600 dark:text-red-300">
                                  {seatLimitError}
                                </p>
                              ) : null}
                            </div>
                          </LabeledField>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={
                              !canManageBilling ||
                              Boolean(seatLimitError) ||
                              !isDirty ||
                              busyAction === `save-${project.id}`
                            }
                            onClick={() => void handleSaveBilling(project)}
                            size="sm"
                            type="button"
                          >
                            <Save className="size-4" />
                            {busyAction === `save-${project.id}` ? "Saving..." : "Save billing"}
                          </Button>
                          <Button
                            disabled={
                              !canManageBilling || !isDirty || busyAction === `save-${project.id}`
                            }
                            onClick={() => resetDraft(project)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Reset
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Usage snapshot</p>
                        <div className="grid gap-2 text-sm text-muted-foreground">
                          <InfoRow
                            label="Compute minutes"
                            value={String(usage?.computeMinutes ?? 0)}
                          />
                          <InfoRow
                            label="Completed runs"
                            value={String(usage?.completedRuns ?? 0)}
                          />
                          <InfoRow label="Open PRs" value={String(usage?.openPullRequests ?? 0)} />
                          <InfoRow
                            label="Ready workspaces"
                            value={String(usage?.readyWorkspaces ?? project.workspaceCount ?? 0)}
                          />
                          <InfoRow label="Run count" value={String(usage?.runCount ?? 0)} />
                          <InfoRow
                            label="Last run"
                            value={formatDate(usage?.lastRunAt ?? project.lastRunAt)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="size-5" />
              Follow-up needed
            </CardTitle>
            <CardDescription>
              Usage-backed placeholder gaps visible for the current org.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <UsageFact
              label="Summary"
              value={`${usageSummary.computeMinutes} compute minutes across ${formatCount(
                usageSummary.runCount,
                "run",
              )}`}
            />
            <UsageFact
              label="Seat coverage"
              value={`${usageSummary.activeSeats} active seats / ${usageSummary.seatLimit} declared`}
            />
            <GapList
              emptyText="Every visible project already has a billing contact."
              label="Missing billing email"
              projects={missingBillingEmail}
            />
            <GapList
              emptyText="Every visible project already has a billing reference."
              label="Missing billing reference"
              projects={missingBillingReference}
            />
            <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
              This MVP still stops short of invoices or payment collection, but it no longer hides
              the compute-time and PR-volume placeholders the backend already exposes.
            </p>
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}

function UsageFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-3 py-2 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}

function GapList({
  emptyText,
  label,
  projects,
}: {
  emptyText: string;
  label: string;
  projects: UsageProject[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        projects.map((project) => (
          <div className="rounded-xl border px-3 py-2 text-sm" key={`${label}-${project.id}`}>
            <p className="font-medium">{project.name}</p>
            <p className="text-muted-foreground">{project.slug}</p>
          </div>
        ))
      )}
    </div>
  );
}

function LabeledField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function billingDraftChanged(project: Project, draft: BillingDraft) {
  return (
    (project.billingEmail ?? "") !== draft.billingEmail ||
    (project.billingPlan ?? "") !== draft.billingPlan ||
    (project.billingReference ?? "") !== draft.billingReference ||
    (project.billingStatus ?? project.status ?? "") !== draft.billingStatus ||
    (project.seatLimit != null ? String(project.seatLimit) : "") !== draft.seatLimit
  );
}

function emptyToNull(value: string) {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function parseSeatLimit(value: string) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Seat limit must be a positive whole number.");
  }

  return parsed;
}

function validateSeatLimit(value: string) {
  try {
    parseSeatLimit(value);
    return null;
  } catch (error) {
    return toErrorMessage(error, "Seat limit is invalid.");
  }
}

const inputClassName =
  "h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20";
