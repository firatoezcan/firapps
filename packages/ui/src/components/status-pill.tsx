import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@firapps/ui/lib/utils";

const statusPillVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium shadow-[var(--shadow-subtle)]",
  {
    variants: {
      tone: {
        neutral:
          "border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-foreground)]",
        success:
          "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-foreground)]",
        warning:
          "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-foreground)]",
        danger:
          "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-foreground)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

function StatusPill({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusPillVariants>) {
  return <span className={cn(statusPillVariants({ tone }), className)} {...props} />;
}

export { StatusPill };
