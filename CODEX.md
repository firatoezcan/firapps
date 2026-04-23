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

Before starting a new work iteration, check `CURRENT.md` if it exists.
`CURRENT.md` is gitignored local state and must track remaining work with an
explicit assignee tag per item (`main` for the primary agent, or the delegated
agent name when ownership has been handed off).

When a repo-operating rule needs to survive beyond the current chat, persisting
it in repo-owned files like `CURRENT.md`, `CODEX.md`, or the canonical skill is
sufficient. Do not wait on a second copy in external memory before treating the
rule as durable.

When the work spans `firapps` and `firops`, operate as the team lead, not as a
lone IC. Split design, hierarchy, and data-layer work deliberately, delegate
platform and sandbox runtime work to the backend lane, and keep the ownership
split explicit in `CURRENT.md`.

Delegation model selection is part of the operating contract:

- frontend, design-system, UX, and browser-facing work must be delegated to
  `gpt-5.5` with `high` reasoning
- `firops` backend, Kubernetes, sandbox, cluster, runtime, and operator work
  must be delegated to `gpt-5.5` with `xhigh` reasoning
