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
  ServerCog,
  ShieldUser,
  Users,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

const controlPlaneRoutes = [
  {
    description: "Project inventory, repository bindings, and billing basics.",
    icon: FolderKanban,
    label: "Projects",
    to: "/projects",
  },
  {
    description: "Overview, deployments, projects, and workspace state.",
    icon: ServerCog,
    label: "Control plane",
    to: "/control-plane",
  },
  {
    description: "Blueprint registry and dispatch setup.",
    icon: LayoutTemplate,
    label: "Blueprints",
    to: "/blueprints",
  },
  {
    description: "Provisioned devboxes, IDE access, and preview routes.",
    icon: Boxes,
    label: "Devboxes",
    to: "/devboxes",
  },
  {
    description: "Run dispatch and execution detail.",
    icon: ClipboardList,
    label: "Runs",
    to: "/runs",
  },
  {
    description: "Queue lens over active and blocked runs.",
    icon: ListOrdered,
    label: "Queue",
    to: "/queue",
  },
  {
    description: "Pull request evidence from run outputs.",
    icon: GitPullRequest,
    label: "Pull requests",
    to: "/pull-requests",
  },
  {
    description: "Organization roster and invitation queue.",
    icon: Users,
    label: "Members",
    to: "/members",
  },
  {
    description: "Billing contact and plan inventory.",
    icon: CreditCard,
    label: "Billing",
    to: "/billing",
  },
  {
    description: "Recent project, workspace, and run events.",
    icon: Activity,
    label: "Activity",
    to: "/activity",
  },
  {
    description: "Operators, deployment health, and invitations.",
    icon: ShieldUser,
    label: "Operators",
    to: "/operators",
  },
] as const;

type ControlPlaneRoutePath = (typeof controlPlaneRoutes)[number]["to"];

export function ControlPlaneNavigation({
  className,
  currentPath,
}: {
  className?: string;
  currentPath?: ControlPlaneRoutePath;
}) {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardHeader>
        <CardTitle>Admin route map</CardTitle>
        <CardDescription>
          Every page below stays grounded in the current Better Auth and internal-api surface. When
          the backend does not expose richer queue, pull request, billing, member, or activity data
          yet, the route calls that out directly instead of pretending.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {controlPlaneRoutes.map((route) => {
          const Icon = route.icon;
          const isCurrent = route.to === currentPath;

          return (
            <div
              className={cn(
                "rounded-2xl border p-4 shadow-sm transition-colors",
                isCurrent ? "border-foreground/30 bg-accent/40" : "border-border/70 bg-background",
              )}
              key={route.to}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="font-medium">{route.label}</p>
                  <p className="text-sm text-muted-foreground">{route.description}</p>
                </div>
                <Icon className="mt-0.5 size-4 text-muted-foreground" />
              </div>
              <div className="mt-4">
                <Button asChild size="sm" type="button" variant={isCurrent ? "default" : "outline"}>
                  <Link aria-current={isCurrent ? "page" : undefined} to={route.to}>
                    {isCurrent ? "Current page" : "Open route"}
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
