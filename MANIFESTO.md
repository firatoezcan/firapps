# Manifesto

`firapps` is a product application monorepo.

That has four direct consequences:

1. The repo owns product source code, shared packages, and repo doctrine.
2. The repo does not own platform control-plane concerns.
3. Vite+ is the canonical command surface.
4. Contract, runtime, and evidence move together.

## Non-negotiable rules

- Use `vp` for install, hooks, dev, check, test, build, and package flows.
- Keep `vite.config.ts` truthful for repo-wide workflow behavior.
- Do not document support unless the code path and verification both exist.
- Keep the repo shape sharp: `apps/` for runnable products, `packages/` for
  shared code, `docs/` for current truth, `.agents/` for explicit delegation.
- Do not smuggle platform, GitOps, cluster, or Velero material into this repo.
- When a change affects operator workflow or reviewer proof, update docs and CI
  in the same pass.

## Product repo stance

- `apps/` may grow to more product surfaces over time, but each app must stay
  clearly product-scoped.
- `packages/` may hold shared UI, domain, content, or configuration modules
  consumed by those apps.
- `.agents/` exists to make team structure explicit in Git, not to hide
  decisions in chat history.
- Reviewer guidance is part of the product repo contract, not optional polish.
