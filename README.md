# firapps

`firapps` is a product application monorepo built on Vite+.

The repository is intentionally narrow: it owns application code, shared
product packages, repo doctrine, and agent workflow guidance. It does not own
platform bootstrap, GitOps overlays, cluster operations, or disaster-recovery
material.

The standard for this repo is simple: current docs, runtime behavior, and
verification must agree.

## Start here

Read in this order:

1. `docs/README.md`
2. `docs/reference/repository-layout.md`
3. `docs/operations/change-integration-process.md`
4. `docs/operations/how-to-verify-changes.md`
5. the relevant contract under `docs/contracts/`
6. `docs/reviews/repository-claim-matrix.md` when you are reviewing or
   preparing a merge

If you need the doctrine first, read `MANIFESTO.md` before step 1.

## What is true now

- `apps/customer-web` and `apps/admin-web` are real TanStack Start frontends.
- `apps/public-api` and `apps/internal-api` are real Hono backends with
  Drizzle-backed Postgres runtime paths.
- `apps/internal-api` owns Better Auth email/password auth, verification,
  password reset, organizations, and invitations for the product surfaces.
- `apps/customer-web` and `apps/admin-web` reach auth and backend APIs through
  same-origin TanStack Start server routes instead of browser-direct calls to
  `:4000` or `:4001`.
- `packages/ui`, `packages/backend-common`, and `packages/db` are real shared
  workspace packages used by those four app surfaces.
- `Tiltfile` plus `dev/k8s/` provide the local-only in-cluster backend loop on
  `kind-platform` with a single-replica CNPG dev database.
- GitHub Actions in `.github/workflows/ci.yml` and
  `.github/workflows/images.yml` build deployable images for the four app
  surfaces and define the downstream `firops` dispatch hook.
- `apps/web` and `packages/foundation` still exist as the earlier bootstrap
  surface while the four-app product shape settles.
- `vite.config.ts` at the repo root is the canonical Vite+ workflow surface for
  linting, formatting, staged-file checks, and task execution behavior.
- `.agents/` carries the visible repo team topology and the durable
  non-trivial-change skill.
- `docs/reviews/` is the reviewer-facing truth boundary for merge decisions.

## Repository map

- `apps/` - runnable product applications, including the two frontends, the two
  backends, and the earlier bootstrap app
- `packages/` - shared UI, backend, database, and bootstrap support code
- `dev/` - local-only Tilt and Kubernetes assets for the product repo's
  in-cluster backend loop
- `docs/` - current truth, contracts, verification, reference, and reviews
- `.agents/` - explicit team topology for Codex and other coding agents

The deeper layout rationale lives in `docs/reference/repository-layout.md`.

## Fast path

```bash
vp install
vp config --hooks-dir .vite-hooks
vp check
vp run -r build
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps vp run public-api#dev
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps vp run internal-api#dev
vp run customer-web#dev
vp run admin-web#dev
```

The backend dev commands expect a reachable Postgres at `localhost:5432`. The
frontend dev commands start TanStack Start servers on `http://localhost:3000`
and `http://localhost:3001`. For the local Better Auth flow, also run Mailpit
on `localhost:1025` and `localhost:8025` and use the browser verification path
from `docs/operations/how-to-verify-changes.md`.

For the local in-cluster backend loop:

```bash
tilt up
```

This uses `Tiltfile` plus `dev/k8s/` to run the two backend services against a
single-replica CNPG cluster on `kind-platform`.

## Explicit non-claims

This repository does not currently claim any of the following:

- platform or GitOps ownership
- cluster, Helm, or deployment automation yet
- Velero, backup, or disaster-recovery flows
- Terraform or Kubernetes overlay ownership

Those are deliberate non-claims, not missing documentation.

## Where to look next

- product boundary: `docs/contracts/product-repo.md`
- toolchain truth: `docs/contracts/toolchain.md`
- team topology: `docs/contracts/agent-team.md`
- reviewer proof matrix: `docs/reviews/repository-claim-matrix.md`
