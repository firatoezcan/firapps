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
    <main className="min-h-svh px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="flex flex-col gap-4 rounded-3xl border border-line-soft bg-surface-raised px-6 py-8 shadow-[var(--shadow-card)] backdrop-blur-md sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            {eyebrow}
          </p>
          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-8">
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground">{description}</p>
            </div>
            {actions ? (
              <div className="flex flex-wrap gap-3 rounded-2xl border border-line-strong bg-surface-action px-4 py-4 shadow-[var(--shadow-subtle)] backdrop-blur-sm lg:max-w-xl lg:justify-end">
                {actions}
              </div>
            ) : null}
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
