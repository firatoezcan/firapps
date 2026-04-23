import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  ClipboardList,
  LayoutTemplate,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sparkles,
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
import {
  createAdminBlueprint,
  deleteAdminBlueprint,
  updateAdminBlueprint,
  useAdminBlueprints,
  useAdminProjects,
} from "../lib/admin-product-data";
import { authClient } from "../lib/auth-client";
import {
  type Blueprint,
  formatDateWithRelative,
  statusTone,
  tenantTone,
  toErrorMessage,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

export const Route = createFileRoute("/blueprints")({
  component: BlueprintsRoute,
});

const defaultStepsInput = [
  "dispatch_received|deterministic|Dispatch received",
  "provision_devbox|deterministic|Provision devbox",
  "implement_changes|agentic|Implement changes",
  "validate_output|deterministic|Validate output",
].join("\n");

function BlueprintsRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageBlueprints = activeRole === "owner" || activeRole === "admin";
  const signInHandoff = buildCustomerSignInHref(getCurrentAdminPath("/blueprints"), "/blueprints");

  const productCollectionsEnabled = Boolean(session && activeOrganization?.id);
  const blueprintsQuery = useAdminBlueprints(productCollectionsEnabled, activeOrganization?.id);
  const projectsQuery = useAdminProjects(productCollectionsEnabled, activeOrganization?.id);
  const blueprintStatus = blueprintsQuery.status;
  const blueprintError = blueprintsQuery.error;
  const blueprints = blueprintsQuery.rows;
  const [archivedBlueprints, setArchivedBlueprints] = useState<Blueprint[]>([]);

  const projectStatus = projectsQuery.status;
  const projectError = projectsQuery.error;
  const projects = projectsQuery.rows;

  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "danger" | "success" } | null>(
    null,
  );

  const [form, setForm] = useState({
    description: "",
    name: "",
    slug: "",
    steps: defaultStepsInput,
    triggerSource: "manual",
  });
  const [slugDirty, setSlugDirty] = useState(false);
  const [editForm, setEditForm] = useState({
    description: "",
    name: "",
    slug: "",
    steps: defaultStepsInput,
    triggerSource: "manual",
  });
  const [editSlugDirty, setEditSlugDirty] = useState(false);

  const selectedBlueprint =
    blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? blueprints[0] ?? null;
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const runComposerSearch = {
    blueprintId: selectedBlueprint?.id,
    projectId: selectedProject?.id,
  };
  const organizationBlueprints = useMemo(
    () => blueprints.filter((blueprint) => blueprint.scope === "organization"),
    [blueprints],
  );
  const attachedBlueprints = useMemo(
    () =>
      blueprints.filter((blueprint) =>
        projects.some((project) => project.defaultBlueprintId === blueprint.id),
      ),
    [blueprints, projects],
  );
  const selectedBlueprintProjectCount = useMemo(
    () =>
      selectedBlueprint
        ? projects.filter((project) => project.defaultBlueprintId === selectedBlueprint.id).length
        : 0,
    [projects, selectedBlueprint],
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
    if (blueprints.length === 0) {
      setSelectedBlueprintId("");
      return;
    }

    const selectionStillExists = blueprints.some(
      (blueprint) => blueprint.id === selectedBlueprintId,
    );

    if (!selectionStillExists) {
      setSelectedBlueprintId(blueprints[0]?.id ?? "");
    }
  }, [blueprints, selectedBlueprintId]);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId("");
      return;
    }

    const selectionStillExists = projects.some((project) => project.id === selectedProjectId);

    if (!selectionStillExists) {
      setSelectedProjectId(projects[0]?.id ?? "");
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedBlueprint || selectedBlueprint.scope !== "organization") {
      return;
    }

    setEditForm({
      description: selectedBlueprint.description,
      name: selectedBlueprint.name,
      slug: selectedBlueprint.slug,
      steps: serializeBlueprintSteps(selectedBlueprint.steps),
      triggerSource: selectedBlueprint.triggerSource,
    });
    setEditSlugDirty(false);
  }, [selectedBlueprint?.id]);

  useEffect(() => {
    if (!editSlugDirty) {
      setEditForm((current) => ({
        ...current,
        slug: slugify(current.name),
      }));
    }
  }, [editForm.name, editSlugDirty]);

  async function refreshEverything() {
    const [nextBlueprints] = await Promise.all([
      blueprintsQuery.refresh(),
      projectsQuery.refresh(),
    ]);

    setArchivedBlueprints((current) =>
      current.filter(
        (archivedBlueprint) =>
          !nextBlueprints.some((blueprint) => blueprint.id === archivedBlueprint.id),
      ),
    );
  }

  async function handleCreateBlueprint() {
    setBusyAction("create-blueprint");
    setNotice(null);

    try {
      const steps = form.steps
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(parseStepLine);

      const created = await createAdminBlueprint({
        description: form.description.trim(),
        name: form.name.trim(),
        slug: form.slug.trim(),
        steps,
        triggerSource: form.triggerSource,
      });

      setNotice({
        message: "Blueprint created.",
        tone: "success",
      });
      setForm({
        description: "",
        name: "",
        slug: "",
        steps: defaultStepsInput,
        triggerSource: "manual",
      });
      setSlugDirty(false);

      if (created?.id) {
        setSelectedBlueprintId(created.id);
      }
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to create blueprint."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUpdateBlueprint() {
    if (!selectedBlueprint || selectedBlueprint.scope !== "organization" || !canManageBlueprints) {
      return;
    }

    setBusyAction(`update-${selectedBlueprint.id}`);
    setNotice(null);

    try {
      await updateAdminBlueprint(selectedBlueprint.id, {
        description: editForm.description.trim(),
        name: editForm.name.trim(),
        slug: editForm.slug.trim(),
        steps: parseSteps(editForm.steps),
        triggerSource: editForm.triggerSource,
      });

      setNotice({
        message: `Blueprint ${editForm.name.trim()} updated.`,
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to update blueprint."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleArchiveBlueprint(blueprint: Blueprint) {
    if (!canManageBlueprints || blueprint.scope !== "organization") {
      return;
    }

    const confirmed = globalThis.confirm?.(
      `Archive blueprint "${blueprint.name}"? Projects using it will keep running, but default Blueprint links are cleared.`,
    );

    if (confirmed === false) {
      return;
    }

    setBusyAction(`archive-${blueprint.id}`);
    setNotice(null);

    try {
      await deleteAdminBlueprint(blueprint.id);

      setArchivedBlueprints((current) => [
        {
          ...blueprint,
          isActive: false,
          updatedAt: new Date().toISOString(),
        },
        ...current.filter((entry) => entry.id !== blueprint.id),
      ]);
      setNotice({
        message: `Blueprint ${blueprint.name} archived.`,
        tone: "success",
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to archive blueprint."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReactivateBlueprint(blueprint: Blueprint) {
    if (!canManageBlueprints) {
      return;
    }

    setBusyAction(`reactivate-${blueprint.id}`);
    setNotice(null);

    try {
      const reactivated = await updateAdminBlueprint(blueprint.id, {
        isActive: true,
      });

      setArchivedBlueprints((current) => current.filter((entry) => entry.id !== blueprint.id));
      setNotice({
        message: `Blueprint ${blueprint.name} reactivated.`,
        tone: "success",
      });
      if (reactivated?.id) {
        setSelectedBlueprintId(reactivated.id);
      }
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to reactivate blueprint."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Blueprint selection and dispatch"
      description="The admin surface now uses the real `/api/internal/blueprints` contract for registry and creation, and it stages a clean handoff into `/runs` instead of hiding the new execution model behind older landing-page flows."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/control-plane">
              <ArrowRight className="size-4 rotate-180" />
              Control plane
            </Link>
          </Button>
          <Button
            aria-label="Refresh blueprints"
            onClick={() => void refreshEverything()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button asChild type="button">
            <Link search={runComposerSearch} to="/runs">
              <ClipboardList className="size-4" />
              Runs
            </Link>
          </Button>
        </>
      }
    >
      <ControlPlaneNavigation currentPath="/blueprints" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Blueprint rows from `/api/internal/blueprints`."
          label="Blueprints"
          tone={statusTone(blueprintStatus)}
          value={String(blueprints.length)}
        />
        <StatCard
          detail="Org-scoped blueprints that can be edited, archived, or reactivated here."
          label="Org owned"
          tone={organizationBlueprints.length > 0 ? "success" : statusTone(blueprintStatus)}
          value={String(organizationBlueprints.length)}
        />
        <StatCard
          detail="Blueprints currently selected as a project default."
          label="In use"
          tone={attachedBlueprints.length > 0 ? "success" : statusTone(projectStatus)}
          value={String(attachedBlueprints.length)}
        />
        <StatCard
          detail="Archived in this browser session and still available for a one-click reactivation."
          label="Archived session"
          tone={archivedBlueprints.length > 0 ? "warning" : "neutral"}
          value={String(archivedBlueprints.length)}
        />
      </SectionGrid>

      <SectionGrid>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Blueprint registry</CardTitle>
                <CardDescription>
                  Available blueprints from the new internal-api contract, including system and
                  organization scope.
                </CardDescription>
              </div>
              <StatusPill tone={statusTone(blueprintStatus)}>{blueprintStatus}</StatusPill>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {blueprintError ? <InlineNotice message={blueprintError} tone="danger" /> : null}
            <div className="space-y-3">
              {blueprints.map((blueprint) => {
                const isSelected = blueprint.id === selectedBlueprint?.id;

                return (
                  <button
                    className={cn(
                      "w-full rounded-2xl border border-border/60 bg-background/90 p-4 text-left transition hover:border-primary/40 hover:bg-primary/5",
                      isSelected && "border-primary/40 bg-primary/5",
                    )}
                    key={blueprint.id}
                    onClick={() => setSelectedBlueprintId(blueprint.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{blueprint.name}</p>
                        <p className="text-sm text-muted-foreground">{blueprint.slug}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill
                          tone={blueprint.scope === "organization" ? "success" : "neutral"}
                        >
                          {blueprint.scope}
                        </StatusPill>
                        <StatusPill tone={blueprint.isActive ? "success" : "warning"}>
                          {blueprint.triggerSource}
                        </StatusPill>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{blueprint.description}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Updated {formatDateWithRelative(blueprint.updatedAt)}</span>
                      <span>
                        {
                          projects.filter((project) => project.defaultBlueprintId === blueprint.id)
                            .length
                        }{" "}
                        default project
                        {projects.filter((project) => project.defaultBlueprintId === blueprint.id)
                          .length === 1
                          ? ""
                          : "s"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {blueprint.steps.map((step) => (
                        <StatusPill
                          key={step.key}
                          tone={step.kind === "agentic" ? "warning" : "neutral"}
                        >
                          {step.label}
                        </StatusPill>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            {blueprints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {blueprintError ?? "No blueprints returned yet."}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create organization blueprint</CardTitle>
            <CardDescription>
              Add a new org-scoped blueprint via `POST /api/internal/blueprints` without cutting the
              current admin route flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}
            <LabeledField label="Blueprint name">
              <input
                className={inputClassName}
                disabled={!canManageBlueprints}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={form.name}
              />
            </LabeledField>
            <LabeledField label="Slug">
              <input
                className={inputClassName}
                disabled={!canManageBlueprints}
                onChange={(event) => {
                  setSlugDirty(true);
                  setForm((current) => ({
                    ...current,
                    slug: event.target.value,
                  }));
                }}
                value={form.slug}
              />
            </LabeledField>
            <LabeledField label="Description">
              <textarea
                className="min-h-24 w-full rounded-xl border border-border/60 bg-background px-3 py-3 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
                disabled={!canManageBlueprints}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                value={form.description}
              />
            </LabeledField>
            <LabeledField label="Trigger source">
              <select
                className={inputClassName}
                disabled={!canManageBlueprints}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    triggerSource: event.target.value,
                  }))
                }
                value={form.triggerSource}
              >
                <option value="manual">manual</option>
                <option value="slack">slack</option>
                <option value="email">email</option>
                <option value="webhook">webhook</option>
              </select>
            </LabeledField>
            <LabeledField label="Steps">
              <textarea
                className="min-h-32 w-full rounded-xl border border-border/60 bg-background px-3 py-3 font-mono text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
                disabled={!canManageBlueprints}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    steps: event.target.value,
                  }))
                }
                value={form.steps}
              />
            </LabeledField>
            <p className="text-xs text-muted-foreground">
              Format each line as `key|kind|label`, where `kind` is `agentic` or `deterministic`.
            </p>
            <Button
              disabled={
                busyAction === "create-blueprint" ||
                !canManageBlueprints ||
                form.name.trim().length === 0 ||
                form.slug.trim().length === 0 ||
                form.description.trim().length === 0
              }
              onClick={() => void handleCreateBlueprint()}
              type="button"
            >
              <Plus className="size-4" />
              {busyAction === "create-blueprint" ? "Creating..." : "Create blueprint"}
            </Button>
          </CardContent>
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card>
          <CardHeader>
            <CardTitle>Dispatch handoff</CardTitle>
            <CardDescription>
              Use the selected blueprint and project as the starting point for a new run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {projectError ? <InlineNotice message={projectError} tone="danger" /> : null}
            <label className="block space-y-2">
              <span className="text-sm font-medium">Target project</span>
              <select
                className={inputClassName}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                value={selectedProject?.id ?? ""}
              >
                {projects.length === 0 ? <option value="">No projects returned</option> : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.slug})
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-border/60 bg-background/90 p-3">
                  <LayoutTemplate className="size-5" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium">
                    {selectedBlueprint?.name ?? "No blueprint selected"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedProject
                      ? `${selectedProject.name} • ${selectedProject.workflowMode ?? "blueprint"}`
                      : "Select a project to prepare the run handoff."}
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-foreground">Organization</dt>
                  <dd>{activeOrganization?.name ?? "none"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Role</dt>
                  <dd>{activeRole ?? "unknown"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Project repository</dt>
                  <dd>
                    {selectedProject?.repoProvider &&
                    selectedProject.repoOwner &&
                    selectedProject.repoName
                      ? `${selectedProject.repoProvider}:${selectedProject.repoOwner}/${selectedProject.repoName}`
                      : "not configured"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Project status</dt>
                  <dd>
                    <StatusPill tone={tenantTone(selectedProject?.status ?? "unknown")}>
                      {selectedProject?.status ?? "unknown"}
                    </StatusPill>
                  </dd>
                </div>
              </dl>
            </div>
            <Button asChild type="button">
              <Link search={runComposerSearch} to="/runs">
                <Send className="size-4" />
                Open run composer
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Selected blueprint lifecycle</CardTitle>
            <CardDescription>
              Edit org-scoped blueprints through `PATCH /api/internal/blueprints/:blueprintId`,
              archive them through `DELETE`, and reactivate any row you archived in this session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}
            {!selectedBlueprint ? (
              <p className="text-sm text-muted-foreground">
                Select a blueprint from the registry to inspect or manage it.
              </p>
            ) : (
              <>
                <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{selectedBlueprint.name}</p>
                      <p className="text-sm text-muted-foreground">{selectedBlueprint.slug}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill
                        tone={selectedBlueprint.scope === "organization" ? "success" : "neutral"}
                      >
                        {selectedBlueprint.scope}
                      </StatusPill>
                      <StatusPill tone={selectedBlueprint.isActive ? "success" : "warning"}>
                        {selectedBlueprint.isActive ? "active" : "archived"}
                      </StatusPill>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-foreground">Defaulted by</dt>
                      <dd>{selectedBlueprintProjectCount} projects</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Trigger source</dt>
                      <dd>{selectedBlueprint.triggerSource}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Created</dt>
                      <dd>{formatDateWithRelative(selectedBlueprint.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Updated</dt>
                      <dd>{formatDateWithRelative(selectedBlueprint.updatedAt)}</dd>
                    </div>
                  </dl>
                </div>

                {selectedBlueprint.scope !== "organization" ? (
                  <div className="space-y-3">
                    <InlineNotice
                      message="System-scoped blueprints are visible here but can only be managed from the seed/runtime side, not from this organization UI."
                      tone="danger"
                    />
                    <FutureStep text="System blueprints remain selectable for run dispatch without exposing edit or archive controls that the backend does not permit." />
                  </div>
                ) : (
                  <>
                    <LabeledField label="Blueprint name">
                      <input
                        className={inputClassName}
                        disabled={!canManageBlueprints}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        value={editForm.name}
                      />
                    </LabeledField>
                    <LabeledField label="Slug">
                      <input
                        className={inputClassName}
                        disabled={!canManageBlueprints}
                        onChange={(event) => {
                          setEditSlugDirty(true);
                          setEditForm((current) => ({
                            ...current,
                            slug: event.target.value,
                          }));
                        }}
                        value={editForm.slug}
                      />
                    </LabeledField>
                    <LabeledField label="Description">
                      <textarea
                        className="min-h-24 w-full rounded-xl border border-border/60 bg-background px-3 py-3 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
                        disabled={!canManageBlueprints}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        value={editForm.description}
                      />
                    </LabeledField>
                    <LabeledField label="Trigger source">
                      <select
                        className={inputClassName}
                        disabled={!canManageBlueprints}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            triggerSource: event.target.value,
                          }))
                        }
                        value={editForm.triggerSource}
                      >
                        <option value="manual">manual</option>
                        <option value="slack">slack</option>
                        <option value="email">email</option>
                        <option value="webhook">webhook</option>
                      </select>
                    </LabeledField>
                    <LabeledField label="Steps">
                      <textarea
                        className="min-h-32 w-full rounded-xl border border-border/60 bg-background px-3 py-3 font-mono text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
                        disabled={!canManageBlueprints}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            steps: event.target.value,
                          }))
                        }
                        value={editForm.steps}
                      />
                    </LabeledField>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={
                          !canManageBlueprints ||
                          busyAction === `update-${selectedBlueprint.id}` ||
                          editForm.name.trim().length === 0 ||
                          editForm.slug.trim().length === 0 ||
                          editForm.description.trim().length === 0
                        }
                        onClick={() => void handleUpdateBlueprint()}
                        type="button"
                      >
                        <Save className="size-4" />
                        {busyAction === `update-${selectedBlueprint.id}`
                          ? "Saving..."
                          : "Save changes"}
                      </Button>
                      <Button
                        disabled={
                          !canManageBlueprints || busyAction === `archive-${selectedBlueprint.id}`
                        }
                        onClick={() => void handleArchiveBlueprint(selectedBlueprint)}
                        type="button"
                        variant="outline"
                      >
                        <Archive className="size-4" />
                        {busyAction === `archive-${selectedBlueprint.id}`
                          ? "Archiving..."
                          : "Archive"}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="space-y-3 border-t pt-4">
              <div>
                <p className="font-medium">Archived this session</p>
                <p className="text-sm text-muted-foreground">
                  The list below is local to this page session because the current list endpoint
                  only returns active blueprints.
                </p>
              </div>
              {archivedBlueprints.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No blueprints have been archived in this session yet.
                </p>
              ) : (
                archivedBlueprints.map((blueprint) => (
                  <div className="rounded-xl border p-3" key={`archived-${blueprint.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{blueprint.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {blueprint.slug} • archived {formatDateWithRelative(blueprint.updatedAt)}
                        </p>
                      </div>
                      <Button
                        disabled={
                          !canManageBlueprints || busyAction === `reactivate-${blueprint.id}`
                        }
                        onClick={() => void handleReactivateBlueprint(blueprint)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <RotateCcw className="size-4" />
                        {busyAction === `reactivate-${blueprint.id}`
                          ? "Reactivating..."
                          : "Reactivate"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </SectionGrid>
    </AppPage>
  );
}

function FutureStep({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
      <div className="rounded-2xl border border-border/60 bg-background/90 p-2">
        <Sparkles className="size-4" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
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

function parseStepLine(line: string) {
  const [keyRaw, kindRaw, labelRaw] = line.split("|").map((part) => part.trim());

  if (!keyRaw || !kindRaw || !labelRaw) {
    throw new Error(`Invalid step line: ${line}`);
  }

  if (kindRaw !== "agentic" && kindRaw !== "deterministic") {
    throw new Error(`Invalid step kind in line: ${line}`);
  }

  return {
    key: keyRaw,
    kind: kindRaw,
    label: labelRaw,
  };
}

function parseSteps(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseStepLine);
}

function serializeBlueprintSteps(steps: Blueprint["steps"]) {
  return steps.map((step) => `${step.key}|${step.kind}|${step.label}`).join("\n");
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const inputClassName =
  "h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20";
