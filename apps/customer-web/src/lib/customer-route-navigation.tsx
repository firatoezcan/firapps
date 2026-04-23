import { Link } from "@tanstack/react-router";
import {
  Building2,
  ClipboardList,
  GitPullRequest,
  LayoutDashboard,
  MailPlus,
  MonitorCog,
  UserRound,
} from "lucide-react";

import { cn } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

type CustomerRoute = {
  description: string;
  icon: typeof LayoutDashboard;
  label: string;
  to: "/" | "/account" | "/invitations" | "/organization" | "/pull-requests" | "/runners" | "/runs";
};

type CustomerRouteGroup = {
  description: string;
  label: string;
  routes: readonly CustomerRoute[];
};

export const customerRouteGroups = [
  {
    description: "Stay in the member-work path first: dashboard, runs, and pull-request follow-up.",
    label: "Work",
    routes: [
      {
        description: "Member dashboard for the next useful action and route handoff.",
        icon: LayoutDashboard,
        label: "Dashboard",
        to: "/",
      },
      {
        description: "Member-scoped run history and current execution state.",
        icon: ClipboardList,
        label: "Runs",
        to: "/runs",
      },
      {
        description: "Pull request links and branch evidence from your runs.",
        icon: GitPullRequest,
        label: "Pull requests",
        to: "/pull-requests",
      },
      {
        description: "Self-hosted Docker runner status, install guidance, and risk notes.",
        icon: MonitorCog,
        label: "Runners",
        to: "/runners",
      },
    ],
  },
  {
    description:
      "Open the wider organization context only when you need roster or devbox visibility.",
    label: "Context",
    routes: [
      {
        description: "Organization roster, assigned projects, and devbox access.",
        icon: Building2,
        label: "Organization",
        to: "/organization",
      },
    ],
  },
  {
    description:
      "Keep invite handling and session management visible, but secondary to the work path.",
    label: "Support",
    routes: [
      {
        description: "Personal invitation inbox and direct invite acceptance links.",
        icon: MailPlus,
        label: "Invitations",
        to: "/invitations",
      },
      {
        description: "Session details, sign-out, and organization switching.",
        icon: UserRound,
        label: "Account",
        to: "/account",
      },
    ],
  },
] as const satisfies readonly CustomerRouteGroup[];

export type CustomerRoutePath = (typeof customerRouteGroups)[number]["routes"][number]["to"];

export function CustomerRouteNavigation({
  className,
  currentPath,
}: {
  className?: string;
  currentPath?: CustomerRoutePath;
}) {
  return (
    <nav className={cn("rounded-2xl border border-dashed bg-muted/20 p-4", className)}>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Workspace quick nav</p>
        <p className="text-sm text-muted-foreground">
          The route order follows the intended member path. This stays compact on interior pages so
          dashboard context and run details keep visual priority.
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {customerRouteGroups.map((group) => (
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
