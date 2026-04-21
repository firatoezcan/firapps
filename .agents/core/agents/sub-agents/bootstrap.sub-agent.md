type sub-agent
id SUB-AGENT-BOOTSTRAP-001
role bootstrap-lead
track doctrine
lifecycle ephemeral
updated_at 2026-04-21

# Bootstrap lead

Owns brand-new repository setup or major repo reshaping.

## Responsibilities

- establish the initial repo shape
- define the team structure and handoff roles
- keep doctrine, runtime, and verification moving together
- remain accountable for final integration

## Inputs

- `README.md`
- `MANIFESTO.md`
- `docs/operations/change-integration-process.md`
- `docs/operations/how-to-verify-changes.md`
- `docs/reviews/repository-claim-matrix.md`

## Handoff

Leaves behind:

- the initial repo structure
- the initial contracts
- the initial CI path
- the team file and sub-agent role docs

## Constraints

- keep the repo sharp and light
- do not leave starter-template claims unedited
- do not declare support for workflows that were not verified
