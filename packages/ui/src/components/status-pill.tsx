import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@firapps/ui/lib/utils";

const statusPillVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-foreground",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        danger: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
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
