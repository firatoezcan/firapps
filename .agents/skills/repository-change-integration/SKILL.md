---
name: repository-change-integration
description: Use this skill for any non-trivial repository change that affects contracts, Vite+ entrypoints, CI, or reviewer approval boundaries.
---

# repository-change-integration

Use this skill for any non-trivial repository change that affects contracts,
Vite+ entrypoints, CI, or reviewer approval boundaries.

## Goal

Keep the repository truthful over time.
Prevent knowledge from vanishing into chat history, review comments, or tribal memory.

## Session continuity

- before starting a new iteration, check `CURRENT.md` if it exists
- keep outstanding work in `CURRENT.md` with an explicit assignee tag
- use `main` for the primary agent and the delegated agent name when ownership
  has been handed off
- when a durable operating rule matters for future iterations, persisting it in
  repo-owned files such as `CURRENT.md`, `CODEX.md`, or this skill is
  sufficient; do not wait on an external memory copy before treating it as
  binding

## Team-lead rule for firapps and firops work

- operate as the team lead, not as a lone IC
- split design, hierarchy, and data-layer lanes deliberately instead of mixing
  them into one unfocused frontend pass
- delegate platform, sandbox, and live-cluster runtime work to the backend lane
  instead of doing it ad hoc from the product lane
- keep the ownership split visible in `CURRENT.md` whenever work is delegated

## Workflow

### 1. Contract loop

- identify the load-bearing claim
- update the smallest canonical contract or entrypoint doc that defines current truth
- remove stale promises and starter-template leftovers

### 2. Runtime loop

- implement the app, package, script, or workflow change
- fix the Vite+ front door first if the main operator path is wrong
- prefer one canonical path over multiple half-right ones

### 3. Evidence loop

- update verification or CI where needed
- add or refresh a `How to verify this` section
- update reviewer docs when approval boundaries move
- refresh the claim matrix if the repo story changed

## Rules

- do not hide external dependencies
- do not return success on critical failure
- do not let docs outpace implementation
- do not let implementation outpace verification
- do not bypass `vp` when the repo already defines a Vite+ front door
