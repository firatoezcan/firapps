import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Boxes, ExternalLink, RefreshCw, ServerCog, TriangleAlert } from "lucide-react";
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

import { authClient } from "../lib/auth-client";
import {
  type LoadStatus,
  type Project,
  type Workspace,
  formatDate,
  normalizeProjects,
  normalizeWorkspaces,
  requestInternalApi,
  toErrorMessage,
  workspaceIsReady,
  workspaceTone,
} from "../lib/control-plane";
import { ControlPlaneNavigation } from "../lib/control-plane-navigation";

type WorkspaceRow = Workspace & {
  projectName: string;
  projectSlug: string;
};

const defaultWorkspaceForm = {
  imageFlavor: "minimal",
  nixPackages: "",
  provider: "daytona",
  repoName: "",
  repoOwner: "",
};

const inputClassName =
  "w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";

export const Route = createFileRoute("/devboxes")({
  component: DevboxesRoute,
});

function DevboxesRoute() {
  const sessionQuery = authClient.useSession();
  const activeOrganizationQuery = authClient.useActiveOrganization();
  const activeMemberRoleQuery = authClient.useActiveMemberRole();

  const session = sessionQuery.data;
  const activeOrganization = activeOrganizationQuery.data ?? null;
  const activeRole =
    ((activeMemberRoleQuery.data ?? null) as { role?: string } | null)?.role ?? null;
  const canManageWorkspaces = activeRole === "owner" || activeRole === "admin";

  const [workspaceStatus, setWorkspaceStatus] = useState<LoadStatus>("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [form, setForm] = useState(defaultWorkspaceForm);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "danger" | "success" } | null>(
    null,
  );

  useEffect(() => {
    if (!session || !activeOrganization?.id) {
      setWorkspaceStatus("idle");
      setWorkspaceError(null);
      setProjects([]);
      setWorkspaces([]);
      return;
    }

    void refreshEverything();
  }, [activeOrganization?.id, session?.session.id]);

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

  const readyWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspaceIsReady(workspace)),
    [workspaces],
  );
  const ideEnabled = useMemo(
    () => workspaces.filter((workspace) => Boolean(workspace.ideUrl)),
    [workspaces],
  );
  const previewEnabled = useMemo(
    () => workspaces.filter((workspace) => Boolean(workspace.previewUrl)),
    [workspaces],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setForm((current) => ({
      ...current,
      repoName:
        current.repoName.trim().length > 0 ? current.repoName : (selectedProject.repoName ?? ""),
      repoOwner:
        current.repoOwner.trim().length > 0 ? current.repoOwner : (selectedProject.repoOwner ?? ""),
    }));
  }, [selectedProject?.id, selectedProject?.repoName, selectedProject?.repoOwner]);

  async function refreshEverything() {
    setWorkspaceStatus("loading");
    setWorkspaceError(null);

    try {
      const projectsPayload = (await requestInternalApi("/projects")) as {
        projects?: unknown[];
      } | null;
      const nextProjects = normalizeProjects(projectsPayload?.projects);

      setProjects(nextProjects);

      if (nextProjects.length === 0) {
        setWorkspaces([]);
        setWorkspaceStatus("ready");
        return;
      }

      const workspacePayloads = await Promise.all(
        nextProjects.map(async (project) => {
          const payload = (await requestInternalApi(
            `/workspaces?tenantId=${encodeURIComponent(project.id)}`,
          )) as { workspaces?: unknown[] } | null;

          return normalizeWorkspaces(payload?.workspaces).map((workspace) => ({
            ...workspace,
            projectName: project.name,
            projectSlug: project.slug,
          }));
        }),
      );

      setWorkspaces(
        workspacePayloads
          .flat()
          .sort(
            (left, right) =>
              new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() -
              new Date(left.updatedAt ?? left.createdAt ?? 0).getTime(),
          ),
      );
      setWorkspaceStatus("ready");
    } catch (caughtError) {
      setWorkspaceStatus("error");
      setWorkspaceError(toErrorMessage(caughtError, "Unable to load devbox inventory."));
      setProjects([]);
      setWorkspaces([]);
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProjectId || !canManageWorkspaces) {
      return;
    }

    setBusyAction("create-workspace");
    setNotice(null);

    try {
      await requestInternalApi("/workspaces", {
        body: JSON.stringify({
          imageFlavor: form.imageFlavor.trim(),
          nixPackages: parsePackageInput(form.nixPackages),
          provider: form.provider.trim(),
          repoName: form.repoName.trim(),
          repoOwner: form.repoOwner.trim(),
          tenantId: selectedProjectId,
        }),
        method: "POST",
      });

      setForm((current) => ({
        ...defaultWorkspaceForm,
        imageFlavor: current.imageFlavor,
        provider: current.provider,
        repoName: current.repoName,
        repoOwner: current.repoOwner,
      }));
      setNotice({
        message: "Devbox created.",
        tone: "success",
      });
      await refreshEverything();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to create workspace."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteWorkspace(workspaceId: string) {
    if (!canManageWorkspaces) {
      return;
    }

    setBusyAction(`delete-${workspaceId}`);
    setNotice(null);

    try {
      await requestInternalApi(`/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
      });

      setNotice({
        message: "Devbox deleted.",
        tone: "success",
      });
      await refreshEverything();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to delete workspace."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppPage
      eyebrow="Admin web"
      title="Devboxes"
      description="The devbox route now owns both the workspace inventory and the create/delete lifecycle around the current `/api/internal/workspaces` contract."
      actions={
        <>
          <Button asChild type="button" variant="outline">
            <Link to="/">
              <ArrowRight className="size-4 rotate-180" />
              Dashboard
            </Link>
          </Button>
          <Button
            aria-label="Refresh devboxes"
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
      <ControlPlaneNavigation currentPath="/devboxes" />

      <SectionGrid className="xl:grid-cols-4">
        <StatCard
          detail="Visible workspace records across all visible projects."
          label="Devboxes"
          tone={workspaceStatus === "error" ? "danger" : "success"}
          value={String(workspaces.length)}
        />
        <StatCard
          detail="Workspaces already marked ready or exposing an IDE URL."
          label="Ready"
          tone={readyWorkspaces.length > 0 ? "success" : "neutral"}
          value={String(readyWorkspaces.length)}
        />
        <StatCard
          detail="Workspace records with a direct IDE URL."
          label="IDE routes"
          tone={ideEnabled.length > 0 ? "success" : "warning"}
          value={String(ideEnabled.length)}
        />
        <StatCard
          detail="Workspace records with a preview route."
          label="Preview routes"
          tone={previewEnabled.length > 0 ? "success" : "neutral"}
          value={String(previewEnabled.length)}
        />
      </SectionGrid>

      {workspaceError ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5" />
                Devbox data unavailable
              </CardTitle>
              <CardDescription>{workspaceError}</CardDescription>
            </CardHeader>
          </Card>
        </SectionGrid>
      ) : null}

      {notice ? (
        <SectionGrid>
          <Card>
            <CardHeader>
              <CardTitle>
                {notice.tone === "success" ? "Devbox action completed" : "Devbox action failed"}
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
              <ServerCog className="size-5" />
              Create devbox
            </CardTitle>
            <CardDescription>
              Provision a workspace for the selected project using the current internal-api
              contract.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void handleCreateWorkspace(event)}>
              <LabeledField label="Project">
                <select
                  className={inputClassName}
                  disabled={!canManageWorkspaces || projects.length === 0}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  value={selectedProjectId}
                >
                  {projects.length === 0 ? <option value="">Create a project first</option> : null}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.slug})
                    </option>
                  ))}
                </select>
              </LabeledField>
              <LabeledField label="Repository owner">
                <input
                  className={inputClassName}
                  disabled={!canManageWorkspaces || !selectedProjectId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, repoOwner: event.target.value }))
                  }
                  placeholder={selectedProject?.repoOwner ?? "firatoezcan"}
                  type="text"
                  value={form.repoOwner}
                />
              </LabeledField>
              <LabeledField label="Repository name">
                <input
                  className={inputClassName}
                  disabled={!canManageWorkspaces || !selectedProjectId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, repoName: event.target.value }))
                  }
                  placeholder={selectedProject?.repoName ?? "firapps"}
                  type="text"
                  value={form.repoName}
                />
              </LabeledField>
              <LabeledField label="Workspace provider">
                <input
                  className={inputClassName}
                  disabled={!canManageWorkspaces || !selectedProjectId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, provider: event.target.value }))
                  }
                  placeholder="daytona"
                  type="text"
                  value={form.provider}
                />
              </LabeledField>
              <LabeledField label="Image flavor">
                <input
                  className={inputClassName}
                  disabled={!canManageWorkspaces || !selectedProjectId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, imageFlavor: event.target.value }))
                  }
                  placeholder="minimal"
                  type="text"
                  value={form.imageFlavor}
                />
              </LabeledField>
              <LabeledField label="Optional nix packages">
                <textarea
                  className={cn(inputClassName, "min-h-24 py-3")}
                  disabled={!canManageWorkspaces || !selectedProjectId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, nixPackages: event.target.value }))
                  }
                  placeholder={"nodejs\npnpm\nuv"}
                  value={form.nixPackages}
                />
              </LabeledField>
              <Button
                disabled={
                  Boolean(busyAction) ||
                  !canManageWorkspaces ||
                  !selectedProjectId ||
                  form.repoOwner.trim().length === 0 ||
                  form.repoName.trim().length === 0 ||
                  form.provider.trim().length === 0 ||
                  form.imageFlavor.trim().length === 0
                }
                type="submit"
              >
                <ServerCog className="size-4" />
                Create devbox
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="size-5" />
              Workspace inventory
            </CardTitle>
            <CardDescription>
              Project-scoped workspace records from `/api/internal/workspaces`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active devboxes yet. They will appear here after a run provisions a workspace.
              </p>
            ) : (
              workspaces.map((workspace) => (
                <div className="rounded-xl border p-4" key={workspace.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {workspace.name ?? workspace.workspaceId} • {workspace.projectName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {workspace.repoOwner}/{workspace.repoName} • {workspace.provider} •{" "}
                        {workspace.imageFlavor}
                      </p>
                    </div>
                    <StatusPill tone={workspaceTone(workspace)}>{workspace.status}</StatusPill>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                    <WorkspaceField label="Project slug" value={workspace.projectSlug} />
                    <WorkspaceField label="Repo provider" value={workspace.repoProvider} />
                    <WorkspaceField label="Created" value={formatDate(workspace.createdAt)} />
                    <WorkspaceField label="Updated" value={formatDate(workspace.updatedAt)} />
                    <WorkspaceField
                      label="Nix packages"
                      value={
                        workspace.nixPackages.length > 0
                          ? workspace.nixPackages.join(", ")
                          : "No extra packages"
                      }
                    />
                    <WorkspaceField label="Workspace id" value={workspace.workspaceId} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {workspace.ideUrl ? (
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={workspace.ideUrl} rel="noreferrer" target="_blank">
                          <ExternalLink className="size-4" />
                          Open IDE
                        </a>
                      </Button>
                    ) : null}
                    {workspace.previewUrl ? (
                      <Button asChild size="sm" type="button" variant="outline">
                        <a href={workspace.previewUrl} rel="noreferrer" target="_blank">
                          <ExternalLink className="size-4" />
                          Preview
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      disabled={Boolean(busyAction) || !canManageWorkspaces}
                      onClick={() => void handleDeleteWorkspace(workspace.workspaceId)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Delete devbox
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

function LabeledField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function WorkspaceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function parsePackageInput(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
