import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  FolderKanban,
  LayoutTemplate,
  RefreshCw,
  Rocket,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

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
import {
  createAdminProject,
  deleteAdminProject,
  updateAdminProject,
  useAdminBlueprints,
  useAdminProjects,
} from "../lib/admin-product-data";
import { authClient } from "../lib/auth-client";
import {
  type DispatchReadiness,
  type Project,
  dispatchReadinessTone,
  formatDate,
  getDispatchReadinessLabel,
  projectHasRepositoryRegistration,
  projectIsDispatchReady,
  tenantTone,
  toErrorMessage,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

const inputClassName =
  "w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";
const readOnlyInputClassName = cn(inputClassName, "bg-muted/40 text-muted-foreground");
const githubRepoProvider = "github";

const defaultProjectForm = {
  billingEmail: "",
  billingPlan: "growth",
  billingReference: "",
  defaultBranch: "main",
  description: "",
  name: "",
  repoName: "",
  repoOwner: "",
  repoProvider: githubRepoProvider,
  slug: "",
  workflowMode: "blueprint",
};

export const Route = createFileRoute("/projects")({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageProjects = activeRole === "owner" || activeRole === "admin";
  const signInHandoff = buildCustomerSignInHref(getCurrentAdminPath("/projects"), "/projects");

  const productCollectionsEnabled = Boolean(session && activeOrganization?.id);
  const projectsQuery = useAdminProjects(productCollectionsEnabled, activeOrganization?.id);
  const blueprintsQuery = useAdminBlueprints(productCollectionsEnabled, activeOrganization?.id);
  const projectStatus = projectsQuery.status;
  const projectError = projectsQuery.error;
  const projects = projectsQuery.rows;
  const blueprintStatus = blueprintsQuery.status;
  const blueprintError = blueprintsQuery.error;
  const blueprints = blueprintsQuery.rows;

  const [form, setForm] = useState(defaultProjectForm);
  const [slugDirty, setSlugDirty] = useState(false);
  const [defaultBlueprintDrafts, setDefaultBlueprintDrafts] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "danger" | "success" } | null>(
    null,
  );

  useEffect(() => {
    if (!sessionQuery.isPending && !session && typeof window !== "undefined") {
      window.location.replace(signInHandoff.href);
    }
  }, [session, sessionQuery.isPending, signInHandoff.href]);

  useEffect(() => {
    if (!slugDirty) {
      setForm((current) => ({
        ...current,
        slug: slugify(current.name),
      }));
    }
  }, [form.name, slugDirty]);

  useEffect(() => {
    setDefaultBlueprintDrafts((current) => {
      const next = { ...current };

      for (const project of projects) {
        if (!(project.id in next)) {
          next[project.id] = project.defaultBlueprintId ?? "";
        }
      }

      return next;
    });
  }, [projects]);

  const repoRegisteredProjects = useMemo(
    () => projects.filter((project) => projectHasRepositoryRegistration(project)),
    [projects],
  );
  const dispatchReadyProjects = useMemo(
    () => projects.filter((project) => projectIsDispatchReady(project)),
    [projects],
  );
  const blueprintBackedProjects = useMemo(
    () => projects.filter((project) => Boolean(project.defaultBlueprintId)),
    [projects],
  );

  async function refreshEverything() {
    await Promise.all([projectsQuery.refresh(), blueprintsQuery.refresh()]);
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManageProjects) {
      return;
    }

    setBusyAction("create-project");
    setNotice(null);

    try {
      await createAdminProject({
        billingEmail: emptyToNull(form.billingEmail),
        billingPlan: emptyToNull(form.billingPlan),
        billingReference: emptyToNull(form.billingReference),
        defaultBranch: emptyToNull(form.defaultBranch) ?? "main",
        description: emptyToNull(form.description),
        name: form.name.trim(),
        repoName: form.repoName.trim(),
        repoOwner: form.repoOwner.trim(),
        repoProvider: githubRepoProvider,
        slug: form.slug.trim(),
        workflowMode: form.workflowMode,
      });

      setForm(defaultProjectForm);
      setSlugDirty(false);
      setNotice({
        message: "Project created.",
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to create project."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveDefaultBlueprint(project: Project) {
    if (!canManageProjects) {
      return;
    }

    setBusyAction(`save-${project.id}`);
    setNotice(null);

    try {
      await updateAdminProject(project.id, {
        defaultBlueprintId: emptyToNull(defaultBlueprintDrafts[project.id] ?? ""),
      });

      setNotice({
        message: `Default Blueprint saved for ${project.name}.`,
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to update the project default Blueprint."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteProject(project: Project) {
    if (!canManageProjects) {
      return;
    }

    setBusyAction(`delete-${project.id}`);
    setNotice(null);

    try {
      await deleteAdminProject(project.id);

      setNotice({
        message: `Project ${project.name} deleted.`,
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to delete project."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Projects"
      description="Project registration now lives on the route that owns it: GitHub repo coordinates, branch validation, billing placeholders, workflow mode, and persistent default Blueprint selection. Repository registration and true dispatch readiness are shown separately so setup stays honest."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/control-plane">
              <ArrowRight className="size-4 rotate-180" />
              Control plane
            </Link>
          </Button>
          <Button
            aria-label="Refresh projects"
            onClick={() => void refreshEverything()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button asChild type="button">
            <Link to="/devboxes">
              <Rocket className="size-4" />
              Devboxes
            </Link>
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/projects" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Projects visible to the active Better Auth organization."
          label="Projects"
          tone={projectStatus === "error" ? "danger" : "success"}
          value={String(projects.length)}
        />
        <StatCard
          detail="Projects whose saved repo owner, name, provider, and default branch satisfy repository registration."
          label="Repo registered"
          tone={
            repoRegisteredProjects.length > 0
              ? "success"
              : projectStatus === "ready"
                ? "warning"
                : "neutral"
          }
          value={String(repoRegisteredProjects.length)}
        />
        <StatCard
          detail="Projects whose dispatch-readiness contract currently says unattended work can run."
          label="Dispatch ready"
          tone={
            dispatchReadyProjects.length > 0
              ? "success"
              : projects.length > 0
                ? "warning"
                : "neutral"
          }
          value={String(dispatchReadyProjects.length)}
        />
        <StatCard
          detail="Projects with a saved default Blueprint."
          label="Blueprint backed"
          tone={
            blueprintBackedProjects.length > 0
              ? "success"
              : blueprintStatus === "error"
                ? "danger"
                : "warning"
          }
          value={String(blueprintBackedProjects.length)}
        />
      </SectionGrid>

      {projectError || blueprintError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Project data unavailable
              </CardTitle>
              <CardDescription>{projectError ?? blueprintError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      {notice ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle>
                {notice.tone === "success" ? "Project updated" : "Project action failed"}
              </CardTitle>
              <CardDescription>{notice.message}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      <SectionGrid className="xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="size-5" />
              Register project
            </CardTitle>
            <CardDescription>
              Create the project record, bind the MVP GitHub repository, and keep workflow, billing,
              and Blueprint defaults on the same setup surface. Dispatch readiness is evaluated
              separately after registration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void handleCreateProject(event)}>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                GitHub is the only supported repository registration path in the MVP. Enter the
                existing GitHub owner, repo, and branch this project should use.
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                Saving repository settings does not mean the project can dispatch unattended work
                yet. The backend also checks provisioner wiring, GitHub token availability, and
                sandbox runtime health.
              </div>
              <LabeledField label="Project name">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Local SaaS control plane"
                  type="text"
                  value={form.name}
                />
              </LabeledField>
              <LabeledField label="Project slug">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) => {
                    setSlugDirty(true);
                    setForm((current) => ({ ...current, slug: event.target.value }));
                  }}
                  placeholder="local-saas-control-plane"
                  type="text"
                  value={form.slug}
                />
              </LabeledField>
              <LabeledField label="Project description">
                <textarea
                  className={cn(inputClassName, "min-h-24 py-3")}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Local-first product that turns work into PRs."
                  value={form.description}
                />
              </LabeledField>
              <LabeledField label="Repository provider">
                <div className="space-y-2">
                  <input
                    aria-readonly="true"
                    className={readOnlyInputClassName}
                    disabled
                    readOnly
                    type="text"
                    value={githubRepoProvider}
                  />
                  <p className="text-xs text-muted-foreground">
                    Non-GitHub providers are not an equal registration path yet. Backend validation
                    currently accepts GitHub repositories only.
                  </p>
                </div>
              </LabeledField>
              <LabeledField label="Repository owner">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, repoOwner: event.target.value }))
                  }
                  placeholder="firatoezcan"
                  type="text"
                  value={form.repoOwner}
                />
              </LabeledField>
              <LabeledField label="Repository name">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, repoName: event.target.value }))
                  }
                  placeholder="firapps"
                  type="text"
                  value={form.repoName}
                />
              </LabeledField>
              <LabeledField label="Default branch">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, defaultBranch: event.target.value }))
                  }
                  placeholder="main"
                  type="text"
                  value={form.defaultBranch}
                />
              </LabeledField>
              <LabeledField label="Workflow mode">
                <select
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, workflowMode: event.target.value }))
                  }
                  value={form.workflowMode}
                >
                  <option value="blueprint">blueprint</option>
                  <option value="manual">manual</option>
                </select>
              </LabeledField>
              <LabeledField label="Billing contact email">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, billingEmail: event.target.value }))
                  }
                  placeholder="billing@example.com"
                  type="email"
                  value={form.billingEmail}
                />
              </LabeledField>
              <LabeledField label="Billing plan">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, billingPlan: event.target.value }))
                  }
                  placeholder="growth"
                  type="text"
                  value={form.billingPlan}
                />
              </LabeledField>
              <LabeledField label="Billing reference">
                <input
                  className={inputClassName}
                  disabled={!canManageProjects}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, billingReference: event.target.value }))
                  }
                  placeholder="cus-demo-001"
                  type="text"
                  value={form.billingReference}
                />
              </LabeledField>
              <Button
                disabled={
                  Boolean(busyAction) ||
                  !canManageProjects ||
                  form.name.trim().length === 0 ||
                  form.slug.trim().length === 0 ||
                  form.repoOwner.trim().length === 0 ||
                  form.repoName.trim().length === 0
                }
                type="submit"
              >
                <FolderKanban className="size-4" />
                Create project
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutTemplate className="size-5" />
              Project inventory
            </CardTitle>
            <CardDescription>
              Each project keeps repository registration, dispatch readiness, billing placeholders,
              and default Blueprint selection together.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects are visible for the active organization yet.
              </p>
            ) : (
              projects.map((project) => {
                const repoRegistered = projectHasRepositoryRegistration(project);
                const dispatchReadiness = project.dispatchReadiness ?? null;

                return (
                  <div className="rounded-xl border p-4" key={project.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {project.repoOwner && project.repoName
                            ? `${project.repoProvider ?? githubRepoProvider}:${project.repoOwner}/${project.repoName}`
                            : "Repository not exposed yet"}{" "}
                          • {project.slug}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <StatusPill tone={tenantTone(project.status)}>{project.status}</StatusPill>
                        <StatusPill tone={repoRegistered ? "success" : "warning"}>
                          {repoRegistered ? "repo registered" : "repo incomplete"}
                        </StatusPill>
                        <StatusPill
                          tone={dispatchReadinessTone(
                            dispatchReadiness?.status,
                            dispatchReadiness?.dispatchReady,
                          )}
                        >
                          {getDispatchReadinessLabel(dispatchReadiness)}
                        </StatusPill>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                      <ProjectField
                        label="Workflow mode"
                        value={project.workflowMode ?? "Not set"}
                      />
                      <ProjectField label="Billing plan" value={project.billingPlan ?? "Not set"} />
                      <ProjectField
                        label="Billing email"
                        value={project.billingEmail ?? "Not set"}
                      />
                      <ProjectField
                        label="Billing reference"
                        value={project.billingReference ?? "Not set"}
                      />
                      <ProjectField
                        label="Default branch"
                        value={project.defaultBranch ?? "Not set"}
                      />
                      <ProjectField
                        label="Workspace count"
                        value={String(project.workspaceCount ?? 0)}
                      />
                      <ProjectField label="Last run" value={formatDate(project.lastRunAt)} />
                      <ProjectField label="Created" value={formatDate(project.createdAt)} />
                    </div>
                    {project.description ? (
                      <p className="mt-3 text-sm text-muted-foreground">{project.description}</p>
                    ) : null}
                    <DispatchReadinessPanel
                      dispatchReadiness={dispatchReadiness}
                      repoRegistered={repoRegistered}
                    />
                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <select
                        className={inputClassName}
                        disabled={!canManageProjects || blueprints.length === 0}
                        onChange={(event) =>
                          setDefaultBlueprintDrafts((current) => ({
                            ...current,
                            [project.id]: event.target.value,
                          }))
                        }
                        value={
                          defaultBlueprintDrafts[project.id] ?? project.defaultBlueprintId ?? ""
                        }
                      >
                        <option value="">No default Blueprint</option>
                        {blueprints.map((blueprint) => (
                          <option key={blueprint.id} value={blueprint.id}>
                            {blueprint.name} ({blueprint.scope})
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={Boolean(busyAction) || !canManageProjects}
                        onClick={() => void handleSaveDefaultBlueprint(project)}
                        type="button"
                        variant="outline"
                      >
                        <Save className="size-4" />
                        Save default
                      </Button>
                      <Button
                        disabled={Boolean(busyAction) || !canManageProjects}
                        onClick={() => void handleDeleteProject(project)}
                        type="button"
                        variant="outline"
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function LabeledField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function ProjectField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function DispatchReadinessPanel({
  dispatchReadiness,
  repoRegistered,
}: {
  dispatchReadiness: DispatchReadiness | null;
  repoRegistered: boolean;
}) {
  const issues = dispatchReadiness?.issues ?? [];

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="font-medium">Dispatch readiness</p>
          <p className="text-sm text-muted-foreground">
            {dispatchReadiness?.detail ??
              "Internal API did not return dispatch readiness for this project yet."}
          </p>
        </div>
        <StatusPill
          tone={dispatchReadinessTone(dispatchReadiness?.status, dispatchReadiness?.dispatchReady)}
        >
          {getDispatchReadinessLabel(dispatchReadiness)}
        </StatusPill>
      </div>
      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
        <ReadinessCheck
          label="Repository registration"
          value={repoRegistered ? "configured" : "missing"}
          tone={repoRegistered ? "success" : "warning"}
        />
        <ReadinessCheck
          label="Provisioner bridge"
          value={formatBooleanCheck(dispatchReadiness?.checks.platformProvisionerConfigured)}
          tone={toneForBooleanCheck(dispatchReadiness?.checks.platformProvisionerConfigured)}
        />
        <ReadinessCheck
          label="GitHub token"
          value={formatBooleanCheck(dispatchReadiness?.checks.githubTokenConfigured)}
          tone={toneForBooleanCheck(dispatchReadiness?.checks.githubTokenConfigured)}
        />
        <ReadinessCheck
          label="Workspace API"
          value={formatBooleanCheck(dispatchReadiness?.checks.sandboxWorkspaceApiHealthy)}
          tone={toneForBooleanCheck(dispatchReadiness?.checks.sandboxWorkspaceApiHealthy)}
        />
        <ReadinessCheck
          label="Sandbox operator"
          value={formatBooleanCheck(dispatchReadiness?.checks.sandboxOperatorHealthy)}
          tone={toneForBooleanCheck(dispatchReadiness?.checks.sandboxOperatorHealthy)}
        />
        <ReadinessCheck
          label="Codex execution"
          value={formatBooleanCheck(dispatchReadiness?.checks.codexExecutionConfigured)}
          tone={toneForBooleanCheck(dispatchReadiness?.checks.codexExecutionConfigured)}
        />
      </div>
      {issues.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-foreground">Current blocking issues</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {issues.map((issue) => (
              <li key={issue}>- {issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReadinessCheck({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: ComponentProps<typeof StatusPill>["tone"];
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
        <StatusPill tone={tone}>{value}</StatusPill>
      </div>
    </div>
  );
}

function formatBooleanCheck(value: boolean | null | undefined) {
  if (value == null) {
    return "unavailable";
  }

  return value ? "ready" : "missing";
}

function toneForBooleanCheck(value: boolean | null | undefined) {
  if (value == null) {
    return "neutral" as const;
  }

  return value ? "success" : "warning";
}

function emptyToNull(value: string) {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
