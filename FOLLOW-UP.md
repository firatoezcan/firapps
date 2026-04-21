# Follow-Up Task

This file is the canonical resume point for the freestyle local-SaaS lane in
the `firapps` product repo.

## Active branch pair

- `firapps`: `freestyle/devboxes-local-saas`
- paired `firops`: `freestyle/devboxes-local-saas`

The coherent source branches left behind for the earlier lane are:

- `firapps`: `epic/fullstack-monorepo`
- `firops`: `firapps/platform-integration`

## GitHub anchors

- milestone: `firatoezcan/firapps` `#1` `Freestyle Local SaaS`
- epic: `#11`
- contract / identity boundary: `#8`
- organization, membership, invitation foundations: `#9`
- React Email, Mailpit, and Playwright invite proof: `#10`

## Repo responsibility in this lane

`firapps` owns:

- authentication and session behavior
- organizations, memberships, and invitations
- React Email templates and the app-side mail contract
- dashboard UX and browser-driven verification
- database migrations, seeds, and app runtime behavior

`firapps` still does not own:

- platform-cluster deployment truth
- local Mailpit deployment manifests
- cluster-side secret placement or rollout automation

Those stay in `firops`.

## Recommended first implementation slice

Start backend-first.

1. Extend `internal-api` with organizations, memberships, invitations, and a
   small mail-transport abstraction.
2. Keep the persistence and migration ownership explicit through Drizzle SQL
   migrations and seeds.
3. After the backend contract is real, add:
   - Mailpit-backed invite delivery
   - invite acceptance UI
   - one rerunnable Playwright proof for the invite flow

Why this slice first:

- it uses the real existing Hono/Drizzle/Postgres seam
- it creates the SaaS identity spine once instead of duplicating auth work
  across both frontends
- it gives later dashboard, org-management, and role work a stable base

## Verification bar for the first slice

Before calling the first slice done, prove:

- migrations apply cleanly for the new identity tables
- an organization can be created
- an invitation can be issued and persisted
- an invite email reaches Mailpit through the local dev path
- the invite can be accepted through a browser-driven flow
- the resulting membership is visible through the intended runtime path

## Resume order

When resuming this lane inside `firapps`, read in this order:

1. `FOLLOW-UP.md`
2. `TASK.md`
3. `docs/contracts/product-repo.md`
4. `docs/contracts/toolchain.md`
5. the current branch state in both repos
