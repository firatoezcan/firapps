# Agent team contract

The repo keeps its team topology in Git so delegation stays explicit and
auditable.

## Team shape

The current product-bootstrap team is defined in:

- `.agents/core/teams/product-bootstrap.team.md`

The role docs live in:

- `.agents/core/agents/sub-agents/`

## Roles

- `bootstrap-lead` - shapes the repo front door and final integration
- `product-planner` - defines scope, touched contracts, and verification loops
- `web-builder` - implements the app surface under `apps/`
- `package-steward` - owns shared package changes under `packages/`
- `docs-integrator` - aligns doctrine, contracts, and reviews
- `qa-verifier` - runs the documented checks and browser smoke
- `review-integrator` - checks claims, non-claims, and merge readiness

## Required handoff for delegated work

Every sub-agent handoff must leave behind:

- files touched
- commands run
- truth changes made
- known gaps or residual risks

## Non-goal

The agent team docs are not hidden automation. They are visible operating
instructions for human and agent contributors.
