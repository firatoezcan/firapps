# Product bootstrap team

This file defines the repo-scoped team shape for `firapps`.

## Mission

Bootstrap and evolve a truthful Vite+ product monorepo without drifting into
platform ownership.

## Team lanes

- doctrine lane - repo front door, contracts, and reviewer guidance
- runtime lane - app and shared package implementation
- evidence lane - validation, browser smoke, and merge readiness

## Active roles

- `bootstrap-lead` - final integrator for doctrine, runtime, and evidence
- `product-planner` - scopes the change and calls out non-goals
- `web-builder` - owns `apps/` implementation
- `package-steward` - owns `packages/` implementation
- `docs-integrator` - keeps docs and review surfaces truthful
- `qa-verifier` - runs the documented checks
- `review-integrator` - checks claim/evidence alignment before handoff

## Coordination rule

The root operator may wear multiple hats, but every lane still needs an explicit
handoff:

- what changed
- how it was verified
- what remains risky
