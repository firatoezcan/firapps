# Current Task

This file is the canonical handoff for the current interrupted `firapps` bootstrap and integration task.

If work resumes after compaction, read this file first.

## Active branches

- `firapps`: `epic/fullstack-monorepo`
- paired `firops` branch: `firapps/platform-integration`

## GitHub coordination

- `firapps` epic: `#1` — bootstrap firapps into a deployable full-stack monorepo
- `firapps` issue `#2` — repo contract, package topology, verification boundary
- `firapps` issue `#3` — shared UI, backend-common, and database packages
- `firapps` issue `#4` — two TanStack Start frontends
- `firapps` issue `#5` — two Hono backends with Drizzle, Postgres, runtime migrations
- `firapps` issue `#6` — Tilt-based in-cluster dev workflow with CNPG-backed Postgres
- `firapps` issue `#7` — CI/CD and GHCR image publication
- paired `firops` issue: `firatoezcan/firops#9` — consume firapps artifacts in the platform repo

## Goal

Turn `firapps` from the current Vite+ starter into a real product monorepo that provides:

- 2 frontend apps built with TanStack Start
- 2 backend services built with Hono
- a shared UI package based on shadcn/ui
- a shared backend/common package
- Drizzle + Postgres
- CI/CD and GHCR publication for deployable images
- local development through Tilt with backends running in-cluster
- a dev CNPG cluster with 1 replica and no sync replication
- `evlog` logging
- no tracing in this pass

## Locked architecture

### Top-level shape

- `apps/` - every deployable runtime surface in this repo
- `packages/` - shared UI, backend, and database code
- `dev/` - local-only developer support assets such as Tilt and Kubernetes manifests
- `docs/` - contracts, verification, and reviewer truth
- `.agents/` - explicit team topology and durable repo skills

### Deployable apps

- `apps/customer-web` - TanStack Start frontend
- `apps/admin-web` - TanStack Start frontend
- `apps/public-api` - Hono backend
- `apps/internal-api` - Hono backend

### Shared packages

- `packages/ui` - shared shadcn-based UI package
- `packages/backend-common` - env parsing, `evlog`, Hono middleware, health/readiness helpers
- `packages/db` - Drizzle + Postgres runtime helpers, migration helpers, shared database primitives

### Runtime decisions

- keep all deployable surfaces under `apps/`; do not introduce a separate `services/` top-level
- use a top-level `dev/` directory for Tilt and local Kubernetes support assets instead of burying them inside `apps/`
- frontends are TanStack Start Node deployables, not static-only bundles
- Hono backends use the Node adapter
- Drizzle uses generated SQL migrations with the `node-postgres` driver
- first-pass database topology is one CNPG cluster plus one application database plus separate PostgreSQL schemas per backend
- runtime migrations must be explicit and reusable so the same image can be used for normal startup and for one-shot migration execution from `firops`

### Database recommendation for `firops`

Collapse the current ambiguity in favor of:

- one CNPG cluster
- one shared application database
- one PostgreSQL schema per backend

Why this is the firapps-side recommendation:

- it matches the current Drizzle layout and migration helpers
- it keeps local CNPG bootstrap simpler for the Tilt/dev path
- it still gives each backend a clear ownership boundary through separate schemas and migration tables

Do not document a separate database+role per backend in `firops` unless the firapps runtime and docs are deliberately changed to match.

## Boundary decisions already made

- `firapps` remains a product repo, not a platform/GitOps repo
- `firops` remains the deployment truth repo
- image publication happens in `firapps`
- image consumption, Flux reconciliation, and cluster placement happen in `firops`
- do not add Velero
- use GitHub issues as the coordination surface for agent work
- use Vite+ as the canonical toolchain front door in `firapps`

## Expected outcome

When this task is complete:

1. `firapps` can build and run two TanStack Start frontends and two Hono backends
2. the backends share common runtime code and connect to Postgres through Drizzle
3. migrations are reproducible and applied safely in the intended runtime/deploy path
4. Tilt can run the backend development loop inside Kubernetes against a dev CNPG cluster
5. the local kind clusters can run the deployed workloads end to end
6. GitHub Actions publishes deployable images from `firapps`
7. Renovate can raise PRs in `firops` to update the published image tags
8. Flux in `firops` can reconcile those updates

## File-level target structure

```text
firapps/
  apps/
    customer-web/
    admin-web/
    public-api/
    internal-api/
  packages/
    ui/
    backend-common/
    db/
  dev/
    k8s/
    tilt/
  docs/
  .agents/
  TASK.md
```

## Acceptance criteria

- `vp` remains the canonical repo front door for install, check, test, build, and app task execution
- both TanStack Start frontends build and have truthful `vp run <app>#dev` paths
- both Hono backends build, start, and connect to Postgres through `packages/db`
- each backend has generated SQL migrations and an explicit runtime migration path
- local Tilt can bring up the backend loop inside Kubernetes against a single-replica CNPG cluster
- the dev-only Kubernetes/Tilt assets are clearly documented as local support material, not GitOps ownership
- GitHub Actions proves the documented repo checks and publishes immutable GHCR images for each deployable app
- the published image naming/versioning is stable enough for downstream Renovate consumption from `firops`

## Required loops

### 1. Contract loop

- update `firapps` contracts so the repo truthfully owns multiple apps, backend services, shared packages, and deployable artifacts
- do not document deployment ownership as living here when it stays in `firops`

### 2. Runtime loop

- implement the monorepo topology, apps, packages, images, Tilt path, and database wiring
- keep `vp` as the front door
- keep runtime migration behavior explicit

### 3. Evidence loop

- update `firapps` verification docs and CI
- add the `firops` verification steps needed to prove the cluster deployment and Renovate handoff
- verify live on the local kind clusters, not just statically

## Verification bar

At minimum, final proof must include:

- repo-level `firapps` verification through documented `vp` commands
- local runtime proof for both frontends and both backends
- Postgres connectivity and migration proof for both backends
- Tilt proof with in-cluster backend pods and dev CNPG
- `firops` deployment proof on the local clusters
- GHCR publication proof
- Renovate PR proof from `firapps` publication into `firops`
- Flux reconciliation proof after the `firops` update lands

## Compaction note

Treat this file as the first repo-local source of truth if the session compacts.
