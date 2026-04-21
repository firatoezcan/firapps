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

- `apps/web` is the first React + TypeScript product app.
- `packages/foundation` is a real shared workspace package consumed by the web
  app.
- `vite.config.ts` at the repo root is the canonical Vite+ workflow surface for
  linting, formatting, staged-file checks, and task execution behavior.
- `.agents/` carries the visible repo team topology and the durable
  non-trivial-change skill.
- `docs/reviews/` is the reviewer-facing truth boundary for merge decisions.

## Repository map

- `apps/` - runnable product applications
- `packages/` - shared product code and copy
- `docs/` - current truth, contracts, verification, reference, and reviews
- `.agents/` - explicit team topology for Codex and other coding agents

The deeper layout rationale lives in `docs/reference/repository-layout.md`.

## Fast path

```bash
vp install
vp config --hooks-dir .vite-hooks
vp check
vp run -r test
vp run -r build
vp run web#dev
```

`vp run web#dev` starts the initial app at the standard Vite dev URL, usually
`http://localhost:5173`.

## Explicit non-claims

This repository does not currently claim any of the following:

- platform or GitOps ownership
- cluster, Helm, or deployment automation
- backend services, databases, or job workers
- Velero, backup, or disaster-recovery flows
- multi-app product surfaces beyond `apps/web`

Those are deliberate non-claims, not missing documentation.

## Where to look next

- product boundary: `docs/contracts/product-repo.md`
- toolchain truth: `docs/contracts/toolchain.md`
- team topology: `docs/contracts/agent-team.md`
- reviewer proof matrix: `docs/reviews/repository-claim-matrix.md`
