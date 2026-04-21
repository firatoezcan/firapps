# Repository layout

This document explains the current structure of the repository.

## Top level

- `apps/` - runnable product applications
- `packages/` - shared product code and repo-facing content packages
- `docs/` - current truth, contracts, verification, and reviews
- `.agents/` - visible team topology and durable repo skills

## `apps/`

`apps/` contains user-facing product surfaces.

### `apps/web/`

- the first React + TypeScript application
- built and served through Vite+ with `vp build` and `vp dev`
- renders the current repo doctrine, boundary, and team model through shared
  workspace data

## `packages/`

`packages/` contains shared code consumed by the apps.

### `packages/foundation/`

- shared repo identity data, review claims, and team cards used by `apps/web`
- packaged with `vp pack`
- tested with `vp test`

## `docs/`

- `docs/contracts/` - the load-bearing truth boundary
- `docs/operations/` - change integration and verification workflow
- `docs/reference/` - structural explanation
- `docs/reviews/` - reviewer guidance and claim/evidence matrix
- `docs/verification/` - verification map
- `docs/archive/` - reserved historical boundary

## `.agents/`

- `.agents/core/teams/` - how the repo-level team is shaped
- `.agents/core/agents/sub-agents/` - role definitions for delegating work
- `.agents/skills/` - durable process skills

## Why this shape matters

The layout keeps product code, truth docs, and delegation rules visible without
turning the repository into an infrastructure control plane.
