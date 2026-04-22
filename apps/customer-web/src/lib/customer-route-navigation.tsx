import { Link } from "@tanstack/react-router";
import {
  Building2,
  ClipboardList,
  GitPullRequest,
  LayoutDashboard,
  MailPlus,
  UserRound,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

const customerRoutes = [
  {
    description: "Member dashboard for my runs, pull requests, and the next useful action.",
    icon: LayoutDashboard,
    label: "Dashboard",
    to: "/",
  },
  {
    description: "Member-scoped run history and current execution state for your work.",
    icon: ClipboardList,
    label: "Runs",
    to: "/runs",
  },
  {
    description: "Pull request links and branch evidence exposed by recent runs.",
    icon: GitPullRequest,
    label: "Pull requests",
    to: "/pull-requests",
  },
  {
    description: "Personal invitation inbox and direct links into invite acceptance flow.",
    icon: MailPlus,
    label: "Invitations",
    to: "/invitations",
  },
  {
    description: "Organization roster, projects, and devbox access.",
    icon: Building2,
    label: "Organization",
    to: "/organization",
  },
  {
    description: "Session details, sign-out, and organization switching.",
    icon: UserRound,
    label: "Account",
    to: "/account",
  },
] as const;

type CustomerRoutePath = (typeof customerRoutes)[number]["to"];

export function CustomerRouteNavigation({
  className,
  currentPath,
}: {
  className?: string;
  currentPath?: CustomerRoutePath;
}) {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardHeader>
        <CardTitle>Workspace routes</CardTitle>
        <CardDescription>
          Each page stays tied to the current Better Auth session and same-origin internal-api read
          surface. When richer controls do not exist yet, the route says so plainly.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {customerRoutes.map((route) => {
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
