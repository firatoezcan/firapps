# Product repo contract

`firapps` is a product application monorepo.

## In scope

- product-facing applications under `apps/`
- product backend services and database runtime code under `apps/`
- shared product UI, backend, and database packages under `packages/`
- local-only in-cluster developer support assets under `dev/` and `Tiltfile`
- repo doctrine, verification, and reviewer guidance under `docs/`
- explicit agent-team topology under `.agents/`
- CI and image workflows that prove the Vite+ workflow and publish deployable
  app images for this repo

## Current truth

- `apps/customer-web` and `apps/admin-web` are the current frontend surfaces
- `apps/public-api` and `apps/internal-api` are the current backend surfaces
- Better Auth in `apps/internal-api` is the canonical auth, session,
  organization, and invitation system for the product
- `apps/customer-web` and `apps/admin-web` proxy `/api/auth/*` and their
  backend API prefixes through same-origin TanStack Start server routes
- when the product runs behind sibling subdomains such as
  `customer.firapps.platform.localhost` and `admin.firapps.platform.localhost`,
  `apps/internal-api` may receive `BETTER_AUTH_COOKIE_DOMAIN` so Better Auth
  can share one session across those product subdomains
- `packages/ui`, `packages/backend-common`, and `packages/db` are real shared
  runtime packages for those apps
- `Tiltfile` plus `dev/k8s/` are the current local-only in-cluster backend
  development path for `kind-platform`
- `.github/workflows/ci.yml` is the automatic repo verification and publish path
  on `main`, `.github/workflows/images.yml` is the manual branch image
  build/push path, and the deployable Docker images carry
  `org.opencontainers.image.source=https://github.com/firatoezcan/firapps` so
  the GHCR packages stay linked to this repository and remain publishable from
  `GITHUB_TOKEN`-backed workflows
- `apps/web` and `packages/foundation` remain as the earlier bootstrap surface
- the repo's front door is the Vite+ workflow documented in
  `docs/contracts/toolchain.md`
- reviewer proof lives in `docs/reviews/repository-claim-matrix.md`

## Explicit non-claims

This repo does not currently claim ownership of:

- platform or GitOps declarations
- cluster or environment orchestration
- Helm charts, Terraform, or Kubernetes overlays
- backup, Velero, or disaster-recovery posture

## Proof surface

Use `docs/operations/how-to-verify-changes.md` for the exact commands that
prove this contract.
