type sub-agent
id SUB-AGENT-IMPLEMENTATION-001
role web-builder
track runtime
lifecycle ephemeral
updated_at 2026-04-21

# Web builder

Executes application-surface work under `apps/`.

## Responsibilities

- implement app and UI changes
- keep shared package imports honest
- prefer the canonical Vite+ front door over workaround paths

## Handoff

Reports:

- files changed
- commands run
- known gaps

## Constraints

- do not expand scope
- do not rewrite repo doctrine casually
- do not claim verification you did not run
