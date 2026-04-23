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
- debug login is not an auth bypass: when `FIRAPPS_DEBUG_LOGIN_ENABLED=true`
  is set on `internal-api`, customer-web `/sign-in` can show known local/test
  personas, ask `internal-api` to provision those verified Better Auth
  credential accounts, and then sign in through the normal Better Auth
  email/password flow; without that runtime flag, the debug persona endpoint
  returns `404` and the menu is hidden
- `apps/internal-api` now also owns the first product control-plane slice for
  org-scoped projects, GitHub-first repository registration validation,
  Blueprint templates, dispatch records, run records, run steps, run
  artifacts, workspace metadata, overview state, activity feeds, richer
  GitHub pull-request metadata, and the founder/operator allowlist boundary
- `apps/customer-web` and `apps/admin-web` proxy `/api/auth/*` and their
  backend API prefixes through same-origin TanStack Start server routes
- `apps/admin-web` and `apps/customer-web` now expose route-level run-detail
  drill-down from `/runs` into `/runs/$runId`, backed by the existing
  `/api/internal/runs/:runId` contract; customer-web still gates that detail
  page to member-visible runs before opening it
- `apps/customer-web` organization routing is now member-assigned-work first:
  assigned runs, assigned projects, pull requests, and ready devboxes lead the
  route, while owner/admin sessions still retain the wider roster, project,
  and organization-devbox visibility below
- `apps/customer-web` home is now a member dashboard first: runs, pull
  requests, next action, recent run/devbox state, and project context lead the
  route, while auth, invitations, and public updates remain secondary support
  surfaces on the same page; zero-project and zero-run founder states now hand
  straight back into admin project, Blueprint, and run setup instead of
  generic dead ends
- `apps/customer-web` `/sign-up-complete` no longer ends at a passive
  verification success card; once the first organization exists it now points
  founders directly into admin project setup while still allowing them to
  continue into the customer workspace
- `apps/admin-web` now exposes both manual dispatch and a product-side
  Slack-style sidechannel dispatch form on `/runs`, so the local MVP no longer
  relies on a raw proof-script fetch alone to exercise that path
- `apps/admin-web` now behaves like a route-level control plane instead of a
  mixed landing page: signed-in org contexts flow into `/control-plane`,
  `/queue` reads a dedicated `/api/internal/queue` snapshot, `/operators`
  forwards the richer provisioner runtime snapshot, `/control-plane` carries a
  concrete first-project -> Blueprint -> run -> review setup sequence, and
  signed-out deep links on core control-plane routes hand users back through
  the Better Auth customer sign-in path
- `apps/admin-web` and `apps/customer-web` now expose `/runners` UI surfaces
  for the user-installed Docker runner lane: `internal-api` owns the MVP
  control-plane schema and structured protocol surfaces for runner
  registration, one-time API-key issuance, hashed key/session storage,
  runner heartbeats, polling leases, structured job creation, append-only
  events, typed results, typed artifacts, and revocation; admin-web owns
  registration/status/API-key handoff UX, customer-web exposes read-only
  status and install guidance, and this repo still does not implement the
  runner daemon image or firops runtime worker
- TanStack DB is the core frontend data layer for product API requests in
  `apps/admin-web` and `apps/customer-web`: product reads and product
  mutations against same-origin `/api/internal/*` and `/api/public/*` must be
  modeled as TanStack DB collections and consumed through the collection/query
  layer instead of route-local ad hoc fetch state
- the current implemented TanStack DB slice is still `apps/admin-web`
  `/queue`: the route uses the existing `/api/internal/queue` HTTP snapshot as
  the client-side collection/cache baseline for queue runs and activity, and it
  can upgrade to `internal-api`'s admin-gated Electric shape proxy endpoints
  for org-scoped runs, dispatches, projects, blueprints, workspaces, run-step
  counts, and activity only when `ELECTRIC_URL` is configured and healthy
- Electric is optional, not the core data-layer contract: every TanStack DB
  product collection must work over backend HTTP snapshot endpoints with the
  existing Better Auth session cookies, and Electric may only be added as an
  org-scoped live-sync source when the backend exposes a narrow shape proxy and
  the route still degrades cleanly to HTTP snapshots
- product mutations from the frontends must update the affected TanStack DB
  collections directly or invalidate/refetch the affected collection queries
  after the backend accepts the mutation; route-local component state may hold
  form drafts and UI affordances, but it must not become the canonical cache for
  product API rows
- Better Auth client flows are exempt from the TanStack DB product API rule:
  sign-in, sign-up, sign-out, session refresh, password reset, email
  verification, active-organization selection, organization membership and
  invitation calls that go through `authClient` may stay on Better Auth's
  client/query path until this repo intentionally wraps them; same-origin
  proxy routes, health checks, static assets, and the guarded local/test debug
  login helper are also outside the product collection boundary
- the current migration inventory is high level and explicit: `admin-web`
  still has direct product API fetch paths in the shared control-plane helper
  plus routes for projects, Blueprints, runs, run detail, pull requests,
  devboxes/workspaces, billing/usage, activity, operators, runners, and
  sidechannel dispatch; `customer-web` still has direct product API fetch paths
  for the public catalog/announcements, member dashboard, projects, overview,
  activity, member-scoped runs and run detail, pull requests, organization,
  and runners; those paths are migration slices, not new precedent
- when the product runs behind sibling subdomains such as
  `customer.firapps.platform.localhost` and `admin.firapps.platform.localhost`,
  `apps/internal-api` may receive `BETTER_AUTH_COOKIE_DOMAIN` so Better Auth
  can share one session across those product subdomains
- org-scoped projects currently persist in the `organization_tenants` table and
  remain additive beside the older seed/demo `tenants` and `deployments`
  surfaces
- the current local-first unattended-work control-plane path is additive and
  honest: the repo now tracks projects, Blueprints, dispatches, runs, run
  steps, and run artifacts; `internal-api` now prefers the workspace-published
  Git branch/commit returned by the provisioner when the isolated devbox can
  push successfully, falls back to the older report-publish branch path when it
  cannot, and `/api/internal/pull-requests` enriches those rows with live
  GitHub review/check metadata when a token is configured; the selected
  Blueprint now feeds a concrete execution-plan section into the provisioner
  report and downstream draft PR artifact instead of stopping at UI-only
  metadata; run-linked devboxes
  expose the actual workspace diff under the `execution_report_patch` artifact
  instead of only the generated report-file delta, so run detail can review
  the real repository mutation that was pushed;
  are reclaimed after a short local retention window so repeated proof runs do
  not exhaust the sandbox node forever, while the historical run detail keeps
  the deleted workspace record; `/api/internal/queue` now centralizes queue
  age, activity, and retry-facing run truth for admin-web; `/api/internal/operator`
  now includes the provisioner runtime snapshot that powers the founder view;
  the deeper devbox execution bridge still depends on the external
  provisioner/runtime seam
- `packages/ui`, `packages/backend-common`, and `packages/db` are real shared
  runtime packages for those apps
- `packages/ui` stays shadcn-compatible and differentiates the product
  primarily through shared design tokens, typography, spacing, and surface
  treatment rather than a bespoke component fork
- the current shared UI token boundary is defined in
  `docs/contracts/shared-ui-token-strategy.md`
- `Tiltfile` plus `dev/k8s/` are the current local-only in-cluster backend
  development path for `kind-platform`
- `.github/workflows/ci.yml` is the automatic repo verification and publish path
  on `main`, and `.github/workflows/images.yml` is the manual branch image
  build/push path
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
