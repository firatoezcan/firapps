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
