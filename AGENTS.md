# Repository operating rules

Start here after `README.md`.

## Reading order

1. `MANIFESTO.md`
2. `docs/README.md`
3. `docs/reference/repository-layout.md`
4. `docs/operations/change-integration-process.md`
5. `docs/operations/how-to-verify-changes.md`
6. the relevant contract under `docs/contracts/`
7. `docs/reviews/repository-claim-matrix.md` when approval boundaries matter
8. the relevant role under `.agents/core/agents/sub-agents/` when delegating
9. `.agents/core/teams/product-bootstrap.team.md` when you need the team shape
10. `.agents/skills/repository-change-integration/SKILL.md` for non-trivial repo changes

## Non-negotiable rules

- Use Vite+ entrypoints instead of ad hoc package-manager commands.
- Keep the repo a product-app repo; do not drift into platform or GitOps material here.
- Do not let docs outpace implementation.
- Do not let implementation outpace verification.
- Keep the root `vite.config.ts` and the documented `vp` workflow aligned.
- Every load-bearing change must update verification guidance and reviewer guidance.

## Required loops for non-trivial work

### 1. Contract loop

State what is true now.
Update the smallest canonical doc under `docs/contracts/`.
Remove starter-template claims once they stop being true.

### 2. Runtime loop

Implement the code and workflow changes.
Prefer one canonical dev path over several half-right paths.
If the main front door is wrong, fix it first.

### 3. Evidence loop

Run the Vite+ validation path.
Update CI when the repo-level workflow changes.
Keep the browser-smoke instructions current.

## Canonical skill

The durable repository skill for non-trivial changes lives at:

- `.agents/skills/repository-change-integration/SKILL.md`
