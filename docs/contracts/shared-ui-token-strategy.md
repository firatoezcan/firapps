# Shared UI token strategy

This document defines the current visual-system boundary for `packages/ui`.

## Goal

Keep `@firapps/ui` close to shadcn ergonomics while giving the product a
distinct, calm, premium operational feel through tokens and a very small shared
surface layer.

## Current truth

- the design system is token-first, not component-inventory-first
- the primary implementation surface is
  `packages/ui/src/styles/globals.css`
- shared differentiation currently comes from warm neutral backgrounds, deep
  ink foregrounds, one disciplined petrol-blue accent family, softer radii
  than stock shadcn defaults, restrained panel shadows and line weights,
  semantic surface tokens for page backdrop, raised shells, cards, and action
  clusters, plus controlled status tokens for neutral, success, warning, and
  danger states
- shared UI component tweaks stay intentionally small and currently stop at
  `app-shell.tsx`, `button.tsx`, `card.tsx`, and `status-pill.tsx`
- customer and admin surfaces consume the same token system; route-level density
  and hierarchy differences stay app-owned instead of forking the theme

## Non-goals

- a bespoke component library separate from shadcn
- page-specific one-off visual snowflakes in `packages/ui`
- a separate customer theme and admin theme with divergent token families
- cosmetic polish that hides hierarchy or product-flow problems

## Verification

Use the focused shared UI verification path in
`docs/operations/how-to-verify-changes.md`.
