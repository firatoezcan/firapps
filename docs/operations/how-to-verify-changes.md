# How to verify changes

This file is the durable verification catalog for the repository's load-bearing
behavior.

## 1. Repo-wide Vite+ verification

**Verification class:** self-contained

### How to verify this

Commands:

```bash
vp install
vp check
vp run -r test
vp run -r build
```

Expected signal:

- dependency installation succeeds
- `vp check` exits `0`
- recursive tests pass across every workspace package that declares `test`
- recursive builds pass across every workspace package that declares `build`

Failure interpretation:

- if `vp check` fails, the repo contract or static quality surface regressed
- if tests fail, shared package exports or rendered repo-copy expectations
  regressed
- if builds fail, the application or package entrypoints no longer match the
  documented Vite+ path

### Focused shared UI token verification

Commands:

```bash
vp run ui#check
vp run customer-web#build
vp run admin-web#build
```

Expected signal:

- `vp run ui#check` exits `0` for the shared shadcn-compatible token surface
- both frontend builds exit `0` while consuming `@firapps/ui`
- no shared UI import, Tailwind token, or TanStack Start packaging error
  appears during the frontend builds

Failure interpretation:

- if `vp run ui#check` fails, the shared UI package contract regressed
- if either frontend build fails after the shared UI change, the token surface
  is no longer compatible with the current app consumers

### Focused TanStack DB core data-layer verification

**Verification class:** self-contained + external-fixture

Commands:

```bash
vp check
vp run internal-api#build
vp run public-api#build
vp run admin-web#build
vp run customer-web#build
```

Expected signal:

- `vp check` exits `0` after contract, verification, and reviewer guidance
  changes
- `internal-api` builds with the queue snapshot, queue metrics, and optional
  admin-gated Electric shape proxy endpoints for the queue slice
- `public-api` still builds for the HTTP-backed public product collection
  source that customer-web must migrate onto
- `admin-web` builds with the `/queue` TanStack DB read path backed by the
  `/api/internal/queue` HTTP snapshot collections, while Electric remains an
  optional live-sync source when configured
- `customer-web` still builds while its current product API fetch paths remain
  an explicit migration inventory rather than new precedent
- for any follow-on migration slice, product API reads and mutations against
  `/api/internal/*` or `/api/public/*` are exposed through TanStack DB
  collections/query consumption; remaining direct product fetches in the
  touched slice are either removed or documented as a named exemption
- Better Auth `authClient` calls for session, sign-in/sign-up, password reset,
  email verification, organization membership, invitations, and active-org
  selection remain allowed outside TanStack DB unless that slice intentionally
  wraps them
- HTTP snapshot collections use same-origin backend endpoints with
  `credentials: "include"`, stable row keys, explicit normalization, and
  auth/error handling that matches the existing backend contract
- frontend mutations call the backend first, then update the affected
  collection rows or invalidate/refetch the affected collection queries before
  reporting success in the UI

External fixture proof, when an Electric sync service is available:

```bash
ELECTRIC_URL=http://127.0.0.1:3000 \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/firapps \
vp run internal-api#dev
vp run admin-web#dev
```

Then open signed-in admin `/queue` and confirm:

- queue cards continue rendering if Electric is unset or unavailable because
  the route seeds TanStack DB from `/api/internal/queue`
- when Electric is configured and healthy, queue runs/activity can update from
  the Electric-backed local collections after the HTTP snapshot has seeded the
  page-local cache, while runtime capacity still comes from
  `/api/internal/queue/metrics`
- the implemented migration boundary is still honest: `/queue` is the only
  completed frontend route on TanStack DB until the follow-on migration slices
  land, and other current route fetches are tracked as migration inventory

Failure interpretation:

- if `vp check` fails after a data-layer contract change, the docs or static
  quality surface regressed
- if `internal-api` build fails, the Electric queue support endpoints or config
  contract regressed
- if `public-api` build fails, the public product HTTP snapshot source
  regressed before customer-web collection migration
- if `admin-web` build fails, the queue route no longer compiles against the
  Electric/TanStack DB slice
- if `customer-web` build fails, the future public/internal collection
  migration surface is already broken
- if signed-in admin `/queue` hard-fails or bypasses TanStack DB when Electric
  is unavailable, the HTTP-backed TanStack DB boundary regressed
- if runtime-capacity cards stop loading unless Electric is healthy, the queue
  metrics split regressed
- if a follow-on migration adds new route-local product fetch state instead of
  collection/query consumption, the core frontend data-layer contract regressed
- if Electric becomes required for a frontend product collection to render
  baseline backend data, the optional-sync boundary regressed

### Focused user-installed runner control-plane verification

**Verification class:** self-contained

Commands:

```bash
vp run internal-api#test
vp run internal-api#build
vp run admin-web#build
vp run customer-web#build
```

Expected signal:

- `internal-api` unit tests prove runner API keys are hashed/previewed, session
  exchange uses a bearer API key outside the JSON body, unsupported protocol
  versions are rejected, unknown operations are rejected, and structured job
  params reject shell/argv/Docker CLI/host-mount fields
- `internal-api` unit tests prove branch/PR runner jobs use the firops daemon's
  operation-specific `repo.prepare`, `git.push`, and `github.create_pr`
  payload shapes, cancellation polling returns an explicit signal, and expired
  leases are classified for requeue or cancellation by the sweeper
- `internal-api` builds with the runner registration, session, heartbeat,
  polling lease, cancellation polling, admin cancellation, expired-lease
  sweep, job status/detail, event, result, artifact, and revocation endpoints
- both frontend builds exit `0` with the `/runners` routes and quick-nav
  entries
- admin-web compiles the typed `/api/internal/runners` client for list,
  registration, and revocation
- customer-web compiles the read-only runner status/install guide against the
  same runner list shape

Failure interpretation:

- if `internal-api` tests fail, the runner API-key/protocol/structured-operation
  boundary, cancellation signal, or lease-expiry policy regressed
- if `internal-api` build fails, the runner schema or Hono endpoint contract
  regressed
- if either build fails, the runner UI surface or route generation regressed
- if the product repo claims a daemon image, Docker socket behavior, or
  firops worker execution, the ownership boundary regressed; this repo owns
  only the product control plane and UI surfaces for the runner lane

## 2. Local hook setup through Vite+

**Verification class:** self-contained

### How to verify this

Commands:

```bash
vp config --hooks-dir .vite-hooks
git config --get core.hooksPath
sed -n '1,40p' .vite-hooks/pre-commit
```

Expected signal:

- `vp config` succeeds without introducing Husky or parallel hook tooling
- `git config --get core.hooksPath` prints `.vite-hooks/_`
- `.vite-hooks/pre-commit` calls `vp staged`

Failure interpretation:

- if hook installation fails, the documented local contributor path regressed
- if `.vite-hooks/pre-commit` stops using `vp staged`, the repo drifted away
  from its canonical Vite+ hook surface

## 3. Backend migration, Better Auth, and API smoke

**Verification class:** runtime

### How to verify this

Commands:

```bash
docker rm -f firapps-pg firapps-mailpit >/dev/null 2>&1 || true
docker run -d --name firapps-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=firapps -p 5432:5432 postgres:16
docker run -d --name firapps-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.27
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps vp run public-api#migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps vp run internal-api#migrate
vp run internal-api#auth:generate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps vp run public-api#dev
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps MAIL_TRANSPORT=smtp MAIL_HOST=127.0.0.1 MAIL_PORT=1025 CUSTOMER_WEB_URL=http://localhost:3000 ADMIN_WEB_URL=http://localhost:3001 vp run internal-api#dev
curl http://localhost:4000/healthz
curl http://localhost:4000/api/public/products
curl http://localhost:4000/api/public/announcements
curl http://localhost:4001/healthz
curl http://localhost:4001/api/auth/get-session
curl -i http://localhost:4001/api/internal/tenants
curl -i http://localhost:4001/api/internal/deployments
curl -i http://localhost:4001/api/internal/projects
curl -i http://localhost:4001/api/internal/blueprints
curl -i http://localhost:4001/api/internal/dispatches
curl -i http://localhost:4001/api/internal/overview
curl -i http://localhost:4001/api/internal/runs
curl -i http://localhost:4001/api/internal/runners
curl -i http://localhost:4001/api/internal/runner-jobs
curl -i http://localhost:4001/api/internal/activity
docker exec firapps-pg psql -U postgres -d firapps -c "select table_schema, table_name from information_schema.tables where table_schema in ('catalog','operations') order by table_schema, table_name;"
docker exec firapps-pg psql -U postgres -d firapps -c "select slug, scope from operations.blueprints order by slug;"
```

Expected signal:

- both migration commands exit `0`
- `vp run internal-api#auth:generate` exits `0`
- `/healthz` returns `{"ok":true,"service":"..."}` for both APIs
- the public API returns seeded `products` and `announcements`
- `GET /api/auth/get-session` returns `null` before a browser session exists
- the internal API returns `401` for `/api/internal/tenants` and
  `/api/internal/deployments` before Better Auth login
- the new protected control-plane endpoints also return `401` before Better
  Auth login:
  - `/api/internal/projects`
  - `/api/internal/blueprints`
  - `/api/internal/dispatches`
  - `/api/internal/overview`
  - `/api/internal/runs`
  - `/api/internal/runners`
  - `/api/internal/runner-jobs`
  - `/api/internal/activity`
- active run records with a provisioned workspace continue advancing from
  `provisioning` to `workspace_ready`, `completed`, or `failed` without a UI
  page needing to fetch `/api/internal/runs`
- the backing Postgres instance contains `catalog.*` tables plus Better Auth
  and internal runtime tables in `operations.*`, including `users`,
  `sessions`, `accounts`, `verifications`, `organizations`,
  `organization_memberships`, `organization_invitations`,
  `organization_tenants`, `organization_workspaces`, `blueprints`,
  `dispatches`, `runs`, `run_steps`, `run_artifacts`,
  `runner_registrations`, `runner_sessions`, `runner_jobs`,
  `runner_job_events`, and `runner_job_artifacts`
- project creation with repository settings now validates the GitHub
  repository and requested default branch against the configured GitHub token,
  so a missing or invalid `GITHUB_TOKEN` will surface at project-registration
  time instead of much later in the PR path
- the startup seed path inserts at least the system Blueprints `ticket-to-pr`
  and `backlog-bugfix`

Failure interpretation:

- if migrations fail, the Drizzle runtime contract or generated SQL drifted
- if Better Auth schema generation fails, the auth config no longer matches the
  Drizzle schema contract
- if healthz succeeds but data endpoints fail, the shared db/runtime wiring or
  seeding path regressed
- if `/api/internal/*` stops returning `401` before login, the protected
  internal-api boundary regressed
- if project registration accepts arbitrary GitHub coordinates without
  validation, the repo-registration contract drifted away from the current
  GitHub-first MVP truth
- if active runs only advance after someone reads `/api/internal/runs`, the
  server-side run reconciliation loop regressed
- if the expected schemas/tables are missing, the shared database ownership
  model is no longer what the repo claims
- if the system Blueprint rows do not exist after startup, the product
  control-plane seed path regressed

### Focused debug login helper verification

**Verification class:** runtime + browser-smoke

Commands:

```bash
FIRAPPS_DEBUG_LOGIN_ENABLED=true \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps \
vp run internal-api#dev
vp run customer-web#dev
curl -fsS http://localhost:4001/api/internal/debug-login/personas
curl -fsS -X POST http://localhost:4001/api/internal/debug-login/personas/founder
```

Then open `http://localhost:3000/sign-in`, use the `Founder operator` debug
login action, and confirm the browser lands on the normal signed-in customer
surface.

Expected signal:

- `FIRAPPS_DEBUG_LOGIN_ENABLED=true` is the only switch that enables this path;
  do not use `NODE_ENV`
- the persona list contains the known local/test personas, but the password is
  only returned by the guarded `POST`
- the `POST` provisions a verified Better Auth credential account and
  organization membership, then the UI signs in through `authClient.signIn.email`
- when `FIRAPPS_DEBUG_LOGIN_ENABLED` is unset or false, the same endpoint
  returns `404` and customer-web hides the menu

Failure interpretation:

- if a debug persona signs in without going through Better Auth email/password,
  the implementation has become an unsupported auth bypass
- if the menu appears while `FIRAPPS_DEBUG_LOGIN_ENABLED` is disabled, the
  runtime config boundary regressed
- if the endpoint works but browser login fails, the Better Auth credential
  provisioning, same-origin proxy, or session-cookie path regressed

## 4. Better Auth browser and proxy sweep

**Verification class:** browser-smoke + external-fixture

### How to verify this

Prerequisites:

- the configured `GITHUB_TOKEN` can validate the target repository and open a
  branch plus draft PR against it
- if the sidechannel dispatch proof should use anything other than the default
  local secret, set `FIRAPPS_DISPATCH_WEBHOOK_SECRET` before running the script
- if the run should prove the preferred workspace-push lane instead of the
  older report-publish fallback, the execution bridge also needs Git
  write credentials inside the provisioner-backed devbox
- the default writable fixture in the current environment is
  `firatoezcan/firops-test-workspace@main`; override it with
  `FIRAPPS_E2E_REPO_OWNER`, `FIRAPPS_E2E_REPO_NAME`, and
  `FIRAPPS_E2E_REPO_BRANCH` if you need a different writable fixture

Commands:

```bash
vp run customer-web#dev
vp run admin-web#dev
FIRAPPS_E2E_REPO_OWNER=firatoezcan \
FIRAPPS_E2E_REPO_NAME=firops-test-workspace \
FIRAPPS_E2E_REPO_BRANCH=main \
node docs/verification/scripts/better-auth-local-e2e.mjs
```

To capture the same user stories as reviewable Playwright videos instead of
only a terminal proof, run the dedicated recorder against the same local
frontends:

```bash
CUSTOMER_WEB_URL=http://127.0.0.1:13000 \
ADMIN_WEB_URL=http://127.0.0.1:13001 \
MAILPIT_API_URL=http://127.0.0.1:18025/api/v1 \
FIRAPPS_E2E_REPO_OWNER=firatoezcan \
FIRAPPS_E2E_REPO_NAME=firops-test-workspace \
FIRAPPS_E2E_REPO_BRANCH=main \
node docs/verification/scripts/record-user-story-videos.mjs
```

Override `FIRAPPS_STORY_VIDEO_DIR` if the generated `.webm` chapters and
manifest should land somewhere other than
`state/verification/story-videos/run-<timestamp>/`.

If you need to run the frontends on non-default ports for a cluster-backed
proof, keep the server-side fallback origins aligned:

```bash
CUSTOMER_WEB_URL=http://127.0.0.1:13000 \
VITE_PUBLIC_API_URL=http://127.0.0.1:14000/api/public \
VITE_INTERNAL_API_URL=http://127.0.0.1:14001/api/internal \
AUTH_PROXY_TARGET=http://127.0.0.1:14001/api/auth \
vp run customer-web#dev -- --host 127.0.0.1 --port 13000
ADMIN_WEB_URL=http://127.0.0.1:13001 \
VITE_INTERNAL_API_URL=http://127.0.0.1:14001/api/internal \
AUTH_PROXY_TARGET=http://127.0.0.1:14001/api/auth \
vp run admin-web#dev -- --host 127.0.0.1 --port 13001
CUSTOMER_WEB_URL=http://127.0.0.1:13000 \
ADMIN_WEB_URL=http://127.0.0.1:13001 \
MAILPIT_API_URL=http://127.0.0.1:18025/api/v1 \
FIRAPPS_E2E_REPO_OWNER=firatoezcan \
FIRAPPS_E2E_REPO_NAME=firops-test-workspace \
FIRAPPS_E2E_REPO_BRANCH=main \
node docs/verification/scripts/better-auth-local-e2e.mjs
```

Expected signal:

- the script prints fresh owner/invitee emails, the writable fixture repo,
  rewritten Mailpit links on `http://localhost:3000`, and
  `PLAYWRIGHT_BETTER_AUTH_E2E_OK`
- owner sign-up completes through customer-web, verifies through Mailpit, and
  creates the first organization
- the verified-owner `/sign-up-complete` page now shows the founder handoff
  into admin project setup, and customer `/` shows the same first-project CTA
  when the account has no registered projects yet
- the Better Auth session created on `localhost` is reused by admin-web on
  `http://localhost:3001`
- admin-web can create an invitation, customer-web can create and verify the
  invitee account, and the invitee can accept the organization membership
- the invitee password reset link resolves through customer-web and a fresh
  browser context can sign in with the new password
- the frontends serve `/api/auth/*`, `/api/public/*`, and `/api/internal/*`
  through their same-origin TanStack Start server routes instead of returning a
  TanStack `Not Found` page
- the admin route-level SaaS surfaces for `/projects`, `/control-plane`,
  `/queue`, `/pull-requests`, `/billing`, `/activity`, and `/devboxes` all
  render against the same Better Auth session and current internal-api
  contract during the same browser proof, including the queue capacity
  snapshot, the control-plane setup sequence cards, and PR review-attention
  cues
- the browser proof saves the created project's default Blueprint from
  `/projects`, then exercises both dispatch entrypoints from the product UI:
  a normal in-product run submission and the Slack-style sidechannel form on
  admin `/runs`
- the browser proof edits an org-scoped Blueprint on `/blueprints`, archives
  it, reactivates it from the same page-session list, and uses the
  Blueprint-to-Run handoff so `/runs` opens with the selected project and
  reactivated Blueprint already preselected; the selected Blueprint now also
  feeds an execution-plan section into the provisioner-generated run report
  artifact
- the admin `/runs` page links directly into `/runs/$runId`, and that detail
  route renders the real run summary, outcome-and-next-action state, steps,
  artifacts, workspace/devbox information, and recent run events from
  `/api/internal/runs/:runId`
- the admin `/members` route creates a second pending invitation, resends it,
  and cancels it, while the main invitee still completes the full Better Auth
  accept-and-reset flow
- the admin `/devboxes` route can create a manual devbox against the selected
  project and delete that same devbox again during the same proof
- the billing route no longer only renders read-only placeholder fields during
  proof; the script updates and saves a billing placeholder for the created
  project and sees the success state in-browser
- the customer `/runs` page also links directly into `/runs/$runId`, and that
  detail route renders the same run fields while preserving the current
  member-scoped visibility rule through the explicit backend filter
  `requestedBy=self` before loading detail
- the customer route-level surfaces for `/runs`, `/pull-requests`,
  `/invitations`, `/organization`, and `/account` all render during the same
  proof, and customer `/` still exposes the member dashboard emphasis through
  "My work hub" plus "Next best action" while the invitee member does not
  receive the owner's run-detail or PR links on the member-scoped customer
  routes
- the invited non-founder member can still inspect the organization-level run
  and pull-request surfaces in admin-web, while founder-only `/operators`
  remains denied for that same session
- the dedicated recorder writes per-story `.webm` chapters, one README index,
  one JSON manifest, and per-actor browser-state snapshots under
  `state/verification/story-videos/run-<timestamp>/`, with visible "NEXT
  ACTION" overlays before each highlighted click or form submission so the
  intended interaction is clear in the videos before it happens
- the run dispatched during the proof advances far enough that the
  `/pull-requests` route shows a real `Open PR` link plus the enriched GitHub
  metadata that `internal-api` can read for the created project instead of
  only an empty state
- the admin `/runs/$runId` detail route exposes an `execution_report_patch`
  artifact whose diff contains the README mutation requested by the proof,
  including the exact `firapps-e2e-run-<runId>` marker line on the published
  workspace branch
- the allowlisted founder/operator account can open `/operators`, while the
  invited non-allowlisted member is denied on that same route
- for subdomain-backed proofs such as `customer.firapps.platform.localhost`
  plus `admin.firapps.platform.localhost`, `internal-api` must run with
  `BETTER_AUTH_COOKIE_DOMAIN` set to the shared parent domain so the owner
  session can move from customer-web to admin-web

Failure interpretation:

- if the script cannot create accounts or sessions, the Better Auth runtime,
  email wiring, or frontend proxy layer regressed
- if Mailpit URLs resolve to `:4001` instead of `localhost:3000`, the auth mail
  rewrite contract regressed
- if admin-web cannot reuse the verified owner session, the shared localhost
  cookie/session path regressed, or the subdomain-backed environment is missing
  `BETTER_AUTH_COOKIE_DOMAIN`
- if `/api/auth/*`, `/api/public/*`, or `/api/internal/*` return the frontend
  router's `Not Found` output, the same-origin server routes regressed
- if the route-level admin surfaces do not render the created project, run, or
  billing data during the browser proof, either the admin route wiring or the
  internal-api read surface regressed
- if the route-level customer surfaces no longer render the owner session,
  member-scoped run data, organization/project context, or account state, the
  customer route wiring regressed
- if the Slack-style sidechannel form on admin `/runs` no longer produces a
  visible second run, the product-side sidechannel dispatch boundary regressed
- if `/blueprints` can no longer edit, archive, reactivate, or hand off the
  selected project-plus-Blueprint into `/runs`, the admin Blueprint lifecycle
  or run-composer handoff contract regressed
- if either `/runs/$runId` detail route stops rendering the persisted run
  summary, steps, artifacts, workspace, or event stream, the run-detail
  frontend contract regressed
- if `/members` can no longer resend and cancel a still-pending invitation
  without breaking the accepted-member path, the admin invitation-lifecycle
  contract regressed
- if `/devboxes` can no longer create and then delete a manual devbox record
  for the selected project, the admin devbox lifecycle contract regressed
- if the invitee can see the owner's customer run-detail or PR links, the
  backend `requestedBy=self` member-scoping contract regressed
- if the invitee can no longer inspect org-level admin `/runs` or
  `/pull-requests` while founder-only `/operators` remains denied, the
  reviewer/member inspection contract regressed
- if the founder can no longer reach `/operators` or the invitee is no longer
  denied there, the operator allowlist boundary regressed
- if the browser proof reaches run dispatch but `/pull-requests` never shows a
  real `Open PR` link with GitHub-side metadata, either the writable GitHub
  fixture path regressed or the run-to-branch/PR contract is no longer working
- if repeated browser-proof reruns start leaving new runs stuck in
  `provisioning` while the sandbox scheduler reports insufficient CPU on the
  `workspace-ide-ready` node, the run-workspace retention cleanup regressed and
  old proof-created devboxes are no longer being reclaimed
- if the writable GitHub fixture PR contains `.ssh/ssh_host_*` files, the
  workspace runtime is leaking daemon state into the repo-backed branch and
  the devbox execution contract regressed
- if the run detail route still shows only the generated report-file diff under
  `execution_report_patch` and no README marker line, the execution-bridge
  artifact contract regressed even if the PR itself was opened
- if the run detail route stops showing the `workspace_push_*` artifacts or no
  longer distinguishes a published workspace branch from the report-publish
  fallback, the execution-bridge publication contract regressed

## 5. Tilt and dev CNPG backend loop

**Verification class:** live-cluster

### How to verify this

Prerequisites:

- `kind-platform` exists and is the intended local backend-dev cluster
- the CNPG operator is installed in `cnpg-system`
- no other process is meant to own `namespace/firapps-dev` during the proof

Commands:

```bash
kubectl --context kind-platform delete namespace firapps-dev --ignore-not-found --wait=true
tilt up --context kind-platform
```

While `tilt up` is still running in that shell, verify the live dev loop from a
second shell:

```bash
kubectl --context kind-platform -n firapps-dev get cluster.postgresql.cnpg.io,deploy,svc,pods
curl -fsS http://127.0.0.1:4000/readyz
curl -fsS http://127.0.0.1:4001/readyz
tilt down --context kind-platform
```

Expected signal:

- Tilt builds `ghcr.io/firatoezcan/firapps-public-api:dev` and
  `ghcr.io/firatoezcan/firapps-internal-api:dev`
- `namespace/firapps-dev` exists and contains `Cluster/firapps-dev-db`,
  `Deployment/public-api`, and `Deployment/internal-api`
- the CNPG cluster reaches `readyInstances=1`
- both backend Deployments reach Ready
- while `tilt up --context kind-platform` is still running, the
  Tilt-configured port-forwards expose `public-api` on `127.0.0.1:4000` and
  `internal-api` on `127.0.0.1:4001`
- both `/readyz` probes return `200`

Failure interpretation:

- if Tilt cannot render `dev/k8s/` or build the backend images, the local
  in-cluster backend loop regressed
- if the CNPG cluster does not become ready, the repo no longer supports the
  documented dev database topology
- if the current kube context is not `kind-platform` and the operator does not
  pass `--context kind-platform`, Tilt should refuse to run rather than deploy
  to the wrong cluster
- if the backend Deployments start but `/readyz` fails, the in-cluster runtime
  contract drifted from the documented service shape

## 6. Image publication and downstream dispatch

**Verification class:** external-fixture

### How to verify this

Prerequisites:

- the current branch has been pushed to GitHub
- `gh auth status` succeeds with `repo`, `workflow`, and `write:packages`
- you want a branch-level publication proof without waiting for a `main` push

Commands:

```bash
git rev-parse HEAD
gh workflow run images.yml --ref <branch-name> -f push=true
gh run list --workflow images.yml --branch <branch-name> --limit 1
gh run watch --exit-status "$(gh run list --workflow images.yml --branch <branch-name> --limit 1 --json databaseId --jq '.[0].databaseId')"
docker manifest inspect ghcr.io/firatoezcan/firapps-customer-web:sha-$(git rev-parse HEAD)
docker manifest inspect ghcr.io/firatoezcan/firapps-admin-web:sha-$(git rev-parse HEAD)
docker manifest inspect ghcr.io/firatoezcan/firapps-public-api:sha-$(git rev-parse HEAD)
docker manifest inspect ghcr.io/firatoezcan/firapps-internal-api:sha-$(git rev-parse HEAD)
```

Expected signal:

- the manual `images.yml` run completes successfully for the current branch
- each deployable surface produces a pullable GHCR image tagged with the full
  commit SHA
- the committed `ci.yml` remains the automatic `main` publish path and carries
  the cross-repo dispatch event type `firapps-image-published`

Failure interpretation:

- if the workflow cannot be triggered or cannot push packages, the branch-level
  GHCR publication path is not usable yet
- if any manifest inspect fails, the documented image publication contract is
  ahead of reality
- if the publish workflow no longer exposes `firapps-image-published`, the
  downstream `firops` update hook regressed
