# Change integration process

Purpose: keep the product repo truthful and prevent workflow decisions from
vanishing into chat or review comments.

## Roles

### Author

Owns the full change across contract, runtime, and evidence.

### Verifier

Tries to break the updated story and checks whether the commands still prove it.

### Reviewer

Checks merge readiness against the repo claim matrix and the product-repo
boundary.

A single person or agent can fill more than one role, but the responsibilities
do not disappear.

## Required change record

Every non-trivial change should be representable in this form:

```text
Claim:
Affected layers:
Hidden assumptions:
Failure mode if wrong:
Verification plan:
Rollback / recovery:
```

## Mandatory three-loop workflow

### 1. Contract loop

- identify the load-bearing claim
- update the smallest canonical contract or front-door doc that defines current
  truth
- remove stale starter or futureware language

### 2. Runtime loop

- implement the app, package, or workflow change
- fix the front door first if the main operator path is wrong
- keep Vite+ as the canonical command surface

### 3. Evidence loop

- run the documented verification path
- update `docs/operations/how-to-verify-changes.md` if expectations changed
- update reviewer guidance when claims or approval boundaries moved

## Verification classes

Each verification note should identify whether it is:

- `self-contained`
- `browser-smoke`
- `external-fixture`

Do not blur those classes in a single undocumented step.

## Merge checklist

A change is merge-ready only when:

- the contract matches the implementation
- the primary Vite+ workflow is still truthful
- the verification notes are up to date
- the reviewer claim matrix still matches the repo surface
- remaining external dependencies are called out explicitly
