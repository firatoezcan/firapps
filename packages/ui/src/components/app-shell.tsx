import type * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@firapps/ui/components/card";
import { StatusPill } from "@firapps/ui/components/status-pill";
import { cn } from "@firapps/ui/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: React.ComponentProps<typeof StatusPill>["tone"];
};

function AppPage({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-svh bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.12),_transparent_42%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.42))] px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-background/80 px-6 py-8 shadow-sm backdrop-blur sm:px-8">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </p>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        </section>
        {children}
      </div>
    </main>
  );
}

function SectionGrid({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("grid gap-5 lg:grid-cols-2", className)} {...props} />;
}

function StatCard({ label, value, detail, tone = "neutral" }: StatCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{label}</CardDescription>
          <StatusPill tone={tone}>{tone}</StatusPill>
        </div>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

export { AppPage, SectionGrid, StatCard };
