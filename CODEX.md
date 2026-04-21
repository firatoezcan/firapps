# Codex entrypoint

Read these files in order:

1. `README.md`
2. `MANIFESTO.md`
3. `docs/README.md`
4. `docs/reference/repository-layout.md`
5. `docs/operations/change-integration-process.md`
6. `docs/operations/how-to-verify-changes.md`
7. the contract you are changing under `docs/contracts/`
8. `docs/reviews/repository-claim-matrix.md` when the change touches repo truth
9. the relevant delegation role under `.agents/core/agents/sub-agents/`
10. `.agents/core/teams/product-bootstrap.team.md` when splitting work
11. `.agents/skills/repository-change-integration/SKILL.md` when the change is non-trivial

Do not invent a parallel workflow.
Do not treat this repo like a platform repo.
Do not replace the Vite+ command surface with package-manager specific commands in docs or CI.
