# Repository claim matrix

This file maps repo claims to their canonical source and proof path.

| Claim                                                       | Canonical source                                                               | Proof path                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `firapps` is a product repo, not a platform or GitOps repo. | `README.md`, `docs/contracts/product-repo.md`                                  | Inspect the top-level layout and run the repo-wide verification path from `docs/operations/how-to-verify-changes.md`. |
| Vite+ is the canonical command surface.                     | `docs/contracts/toolchain.md`, `vite.config.ts`, `.github/workflows/ci.yml`    | Run `vp install`, `vp check`, `vp run -r test`, and `vp run -r build`.                                                |
| The initial app consumes real shared workspace code.        | `apps/web/src/App.tsx`, `packages/foundation/src/index.ts`                     | Run `vp run -r test`, `vp run -r build`, then `vp run web#dev` and inspect the landing page.                          |
| Reviewer guidance is part of the repo contract.             | `docs/reviews/README.md`, this file                                            | Confirm review docs exist and still match the current repo shape and verification path.                               |
| Team topology is explicit and repo-scoped.                  | `docs/contracts/agent-team.md`, `.agents/core/teams/product-bootstrap.team.md` | Read the team file and sub-agent docs; confirm they reference product-app work rather than platform ownership.        |

## Approval boundary

If a change alters repo shape, toolchain commands, or reviewer proof, update the
matching contract and this matrix in the same change.
