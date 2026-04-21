# How to verify changes

This file is the durable verification catalog for the repository's load-bearing
behavior.

## 1. Repo-wide Vite+ verification

**Verification class:** self-contained

### How to verify this

Commands:

```bash
vp install
vp check
vp run -r test
vp run -r build
```

Expected signal:

- dependency installation succeeds
- `vp check` exits `0`
- recursive tests pass across every workspace package that declares `test`
- recursive builds pass across every workspace package that declares `build`

Failure interpretation:

- if `vp check` fails, the repo contract or static quality surface regressed
- if tests fail, shared package exports or rendered repo-copy expectations
  regressed
- if builds fail, the application or package entrypoints no longer match the
  documented Vite+ path

## 2. Local hook setup through Vite+

**Verification class:** self-contained

### How to verify this

Commands:

```bash
vp config --hooks-dir .vite-hooks
git config --get core.hooksPath
sed -n '1,40p' .vite-hooks/pre-commit
```

Expected signal:

- `vp config` succeeds without introducing Husky or parallel hook tooling
- `git config --get core.hooksPath` prints `.vite-hooks/_`
- `.vite-hooks/pre-commit` calls `vp staged`

Failure interpretation:

- if hook installation fails, the documented local contributor path regressed
- if `.vite-hooks/pre-commit` stops using `vp staged`, the repo drifted away
  from its canonical Vite+ hook surface

## 3. Browser smoke for the web bootstrap

**Verification class:** browser-smoke

### How to verify this

Commands:

```bash
vp run web#dev
```

Then open `http://localhost:5173`.

Expected signal:

- the landing page renders the repo boundary, Vite+ front door, team cards, and
  reviewer claims
- the page does not mention platform, GitOps, cluster, or backup ownership

Failure interpretation:

- if the page renders but contradicts the contracts, the repo story is no longer
  internally consistent
- if the page does not load, the documented application bootstrap regressed
