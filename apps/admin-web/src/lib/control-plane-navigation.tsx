import { Link } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  ClipboardList,
  CreditCard,
  FolderKanban,
  GitPullRequest,
  LayoutTemplate,
  ListOrdered,
  MonitorCog,
  ServerCog,
  ShieldUser,
  Users,
} from "lucide-react";

import { cn } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

type ControlPlaneRoute = {
  description: string;
  icon: typeof FolderKanban;
  label: string;
  to:
    | "/activity"
    | "/billing"
    | "/blueprints"
    | "/control-plane"
    | "/devboxes"
    | "/members"
    | "/operators"
    | "/projects"
    | "/pull-requests"
    | "/queue"
    | "/runners"
    | "/runs";
};

type ControlPlaneRouteGroup = {
  description: string;
  label: string;
  routes: readonly ControlPlaneRoute[];
};

export const controlPlaneRouteGroups = [
  {
    description:
      "Choose the current organization, register projects, and define the execution shape.",
    label: "Start",
    routes: [
      {
        description: "Overview and the setup sequence for the active organization.",
        icon: ServerCog,
        label: "Control plane",
        to: "/control-plane",
      },
      {
        description: "Project inventory, repository bindings, and billing basics.",
        icon: FolderKanban,
        label: "Projects",
        to: "/projects",
      },
      {
        description: "Blueprint registry and dispatch defaults.",
        icon: LayoutTemplate,
        label: "Blueprints",
        to: "/blueprints",
      },
      {
        description: "Organization roster and invitation queue.",
        icon: Users,
        label: "Members",
        to: "/members",
      },
    ],
  },
  {
    description: "Operate the active queue, follow execution, and inspect runtime capacity.",
    label: "Operate",
    routes: [
      {
        description: "Queue lens over active and blocked runs.",
        icon: ListOrdered,
        label: "Queue",
        to: "/queue",
      },
      {
        description: "Run dispatch and execution detail.",
        icon: ClipboardList,
        label: "Runs",
        to: "/runs",
      },
      {
        description: "Provisioned devboxes, IDE access, and preview routes.",
        icon: Boxes,
        label: "Devboxes",
        to: "/devboxes",
      },
      {
        description: "User-installed Docker runner enrollment, key handoff, and status.",
        icon: MonitorCog,
        label: "Runners",
        to: "/runners",
      },
      {
        description: "Operators, deployment health, and workspace capacity.",
        icon: ShieldUser,
        label: "Operators",
        to: "/operators",
      },
    ],
  },
  {
    description: "Review what shipped, who is involved, and what still needs attention.",
    label: "Review",
    routes: [
      {
        description: "Pull request evidence from run outputs.",
        icon: GitPullRequest,
        label: "Pull requests",
        to: "/pull-requests",
      },
      {
        description: "Recent project, workspace, and run events.",
        icon: Activity,
        label: "Activity",
        to: "/activity",
      },
      {
        description: "Billing contact and plan inventory.",
        icon: CreditCard,
        label: "Billing",
        to: "/billing",
      },
    ],
  },
] as const satisfies readonly ControlPlaneRouteGroup[];

export type ControlPlaneRoutePath =
  (typeof controlPlaneRouteGroups)[number]["routes"][number]["to"];

export function ControlPlaneNavigation({
  className,
  currentPath,
}: {
  className?: string;
  currentPath?: ControlPlaneRoutePath;
}) {
  return (
    <nav className={cn("rounded-2xl border border-dashed bg-muted/20 p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Admin quick nav</p>
          <p className="text-sm text-muted-foreground">
            Dedicated routes own setup, queue, runtime, and review work. This stays compact so it
            supports the page instead of becoming the page.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {controlPlaneRouteGroups.map((group) => (
          <div className="space-y-3" key={group.label}>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {group.label}
              </p>
              <p className="text-sm text-muted-foreground">{group.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {group.routes.map((route) => {
                const isCurrent = route.to === currentPath;

                return (
                  <Button
                    asChild
                    key={route.to}
                    size="sm"
                    type="button"
                    variant={isCurrent ? "default" : "outline"}
                  >
                    <Link aria-current={isCurrent ? "page" : undefined} to={route.to}>
                      <route.icon className="size-4" />
                      {route.label}
                    </Link>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
