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
docker exec firapps-pg psql -U postgres -d firapps -c "select table_schema, table_name from information_schema.tables where table_schema in ('catalog','operations') order by table_schema, table_name;"
```

Expected signal:

- both migration commands exit `0`
- `vp run internal-api#auth:generate` exits `0`
- `/healthz` returns `{"ok":true,"service":"..."}` for both APIs
- the public API returns seeded `products` and `announcements`
- `GET /api/auth/get-session` returns `null` before a browser session exists
- the internal API returns `401` for `/api/internal/tenants` and
  `/api/internal/deployments` before Better Auth login
- the backing Postgres instance contains `catalog.*` tables plus Better Auth
  and internal runtime tables in `operations.*`, including `users`,
  `sessions`, `accounts`, `verifications`, `organizations`,
  `organization_memberships`, and `organization_invitations`

Failure interpretation:

- if migrations fail, the Drizzle runtime contract or generated SQL drifted
- if Better Auth schema generation fails, the auth config no longer matches the
  Drizzle schema contract
- if healthz succeeds but data endpoints fail, the shared db/runtime wiring or
  seeding path regressed
- if `/api/internal/*` stops returning `401` before login, the protected
  internal-api boundary regressed
- if the expected schemas/tables are missing, the shared database ownership
  model is no longer what the repo claims

## 4. Better Auth browser and proxy sweep

**Verification class:** browser-smoke

### How to verify this

Commands:

```bash
vp run customer-web#dev
vp run admin-web#dev
node docs/verification/scripts/better-auth-local-e2e.mjs
```

If you need to run the frontends on non-default ports for a cluster-backed
proof, keep the server-side fallback origins aligned:

```bash
CUSTOMER_WEB_URL=http://127.0.0.1:13000 \
VITE_PUBLIC_API_URL=http://127.0.0.1:14000/api/public \
AUTH_PROXY_TARGET=http://127.0.0.1:14001/api/auth \
vp run customer-web#dev -- --host 127.0.0.1 --port 13000
ADMIN_WEB_URL=http://127.0.0.1:13001 \
VITE_INTERNAL_API_URL=http://127.0.0.1:14001/api/internal \
AUTH_PROXY_TARGET=http://127.0.0.1:14001/api/auth \
vp run admin-web#dev -- --host 127.0.0.1 --port 13001
CUSTOMER_WEB_URL=http://127.0.0.1:13000 \
ADMIN_WEB_URL=http://127.0.0.1:13001 \
MAILPIT_API_URL=http://127.0.0.1:18025/api/v1 \
node docs/verification/scripts/better-auth-local-e2e.mjs
```

Expected signal:

- the script prints fresh owner/invitee emails, rewritten Mailpit links on
  `http://localhost:3000`, and `PLAYWRIGHT_BETTER_AUTH_E2E_OK`
- owner sign-up completes through customer-web, verifies through Mailpit, and
  creates the first organization
- the Better Auth session created on `localhost` is reused by admin-web on
  `http://localhost:3001`
- admin-web can create an invitation, customer-web can create and verify the
  invitee account, and the invitee can accept the organization membership
- the invitee password reset link resolves through customer-web and a fresh
  browser context can sign in with the new password
- the frontends serve `/api/auth/*`, `/api/public/*`, and `/api/internal/*`
  through their same-origin TanStack Start server routes instead of returning a
  TanStack `Not Found` page
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
- the GitHub repo secrets `GHCR_WRITE_TOKEN` and
  `FIROPS_REPOSITORY_DISPATCH_TOKEN` are configured when you expect push and
  downstream-dispatch steps to succeed
- you want a branch-level publication proof without waiting for a `main` push

Commands:

```bash
git rev-parse HEAD
gh workflow run images.yml --ref <branch-name> -f push=true
gh run list --workflow images.yml --branch <branch-name> --limit 1
gh run watch --exit-status "$(gh run list --workflow images.yml --branch <branch-name> --limit 1 --json databaseId --jq '.[0].databaseId')"
gh api /users/firatoezcan/packages/container/firapps-customer-web --jq '.repository.full_name'
gh api /users/firatoezcan/packages/container/firapps-admin-web --jq '.repository.full_name'
gh api /users/firatoezcan/packages/container/firapps-public-api --jq '.repository.full_name'
gh api /users/firatoezcan/packages/container/firapps-internal-api --jq '.repository.full_name'
docker manifest inspect ghcr.io/firatoezcan/firapps-customer-web:sha-$(git rev-parse HEAD)
docker manifest inspect ghcr.io/firatoezcan/firapps-admin-web:sha-$(git rev-parse HEAD)
docker manifest inspect ghcr.io/firatoezcan/firapps-public-api:sha-$(git rev-parse HEAD)
docker manifest inspect ghcr.io/firatoezcan/firapps-internal-api:sha-$(git rev-parse HEAD)
```

Expected signal:

- the manual `images.yml` run completes successfully for the current branch
- each GHCR package reports `firatoezcan/firapps` as its linked repository
- each deployable surface produces a pullable GHCR image tagged with the full
  commit SHA
- the committed `ci.yml` remains the automatic `main` publish path and carries
  the cross-repo dispatch event type `firapps-image-published`

Failure interpretation:

- if the workflow cannot be triggered or cannot push packages, the branch-level
  GHCR publication path is not usable yet
- if `GHCR_WRITE_TOKEN` is missing or lacks package scope, GHCR publication
  will fail even when the package metadata itself is linked correctly
- if any package returns `null` for `.repository.full_name`, the GHCR package
  is no longer linked to `firatoezcan/firapps`
- if any manifest inspect fails, the documented image publication contract is
  ahead of reality
- if the publish workflow no longer exposes `firapps-image-published`, the
  downstream `firops` update hook regressed
