# Product repo contract

`firapps` is a product application monorepo.

## In scope

- product-facing applications under `apps/`
- shared product code and content packages under `packages/`
- repo doctrine, verification, and reviewer guidance under `docs/`
- explicit agent-team topology under `.agents/`
- CI that proves the Vite+ workflow for this repo

## Current truth

- `apps/web` is the first runnable application in this repo
- `packages/foundation` is shared workspace code, not placeholder filler
- the repo's front door is the Vite+ workflow documented in
  `docs/contracts/toolchain.md`
- reviewer proof lives in `docs/reviews/repository-claim-matrix.md`

## Explicit non-claims

This repo does not currently claim ownership of:

- platform or GitOps declarations
- cluster or environment orchestration
- backend services or persistent data stores
- Helm charts, Terraform, or Kubernetes overlays
- backup, Velero, or disaster-recovery posture

## Proof surface

Use `docs/operations/how-to-verify-changes.md` for the exact commands that
prove this contract.
