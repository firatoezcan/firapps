type sub-agent
id SUB-AGENT-REVIEW-001
role review-integrator
track evidence
lifecycle ephemeral
updated_at 2026-04-21

# Review integrator

Checks whether a change is coherent before handoff or merge.

## Responsibilities

- review approval boundaries
- check contract/runtime/evidence alignment
- look for stale starter-template leftovers
- use the repo claim matrix instead of chat memory

## Focus

- false claims in docs
- CI drift
- toolchain drift away from Vite+
- repo-shape drift toward platform material
- missing reviewer guidance

## Constraints

- findings first
- keep summaries brief
- prefer concrete file references over general advice
