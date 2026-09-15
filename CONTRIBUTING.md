# Contributing to DepCanary

## Requirements

- Node.js `>=22`
- npm

## Setup

```console
git clone <repo>
cd depcanary
npm ci
npm run check
```

`npm run check` runs format checking, linting, type checking, the full test
suite, and the build. It's the single command to run before committing or
opening a pull request.

Other useful scripts:

```console
npm run test:unit
npm run test:integration
npm run test:cli
npm run test:coverage
npm run smoke        # pack the tarball, install it in a clean temp project, run it
npm run test:live    # optional, manual, hits the real npm registry — never run in CI
```

## Fixture philosophy

DepCanary's core product claim is **behavioral delta**, not "this package
uses a risky API." Every detector fixture must prove the whole invariant,
not just the positive case:

- old absent, new present → a finding is produced;
- old present, new unchanged → **no** new finding is produced;
- old present, new removed → **no** "introduced" finding is produced;
- old benign, new risky → a finding is produced.

The second case is the one that differentiates DepCanary from a naive
"grep for `eval`" scanner. Never merge a detector without a fixture proving
it.

Fixtures live under `fixtures/packages/<name>/{before,after}/` as minimal,
synthetic `package.json` + source files — never real malware samples, never
copies of real published packages' source.

## Adding a detector

A new detector must ship with all of the following in the same change:

1. A detector implementation with a stable code (`DRxxx`), title,
   description, default severity, and delta semantics, following the
   `Detector` interface in `src/detectors/types.ts`.
2. A paired before/after fixture under `fixtures/packages/` demonstrating
   the introduced case.
3. An unchanged-behavior regression fixture proving the capability is not
   re-reported when present in both versions.
4. Tests covering the fixture-proven invariants above, plus edge cases
   (CommonJS and ESM forms, comments/strings that must not false-positive,
   etc., as relevant).
5. A `docs/detectors.md` update, kept consistent with what
   `depcanary explain <CODE>` prints.
6. An explicit, documented scoring decision in `docs/scoring.md` (default
   severity, and whether the code participates in any combination-bonus
   grouping in `src/scoring/score.ts`).

## Security constraints

DepCanary analyzes hostile input by design (arbitrary npm tarballs). Treat
`src/archive/`, `src/registry/`, and detector delta logic as
security-sensitive code:

- never execute target package code, lifecycle scripts, or binaries;
- never let archive extraction escape the temporary extraction root;
- never weaken integrity verification or resource limits to make a test
  pass — fix the underlying issue instead;
- new adversarial fixtures (traversal, symlink escape, archive bombs,
  oversized files) are welcome and should never be removed because they're
  inconvenient.

## Pull request expectations

- Keep changes focused; unrelated refactors belong in a separate PR.
- `npm run check` must pass locally before opening a PR.
- Include or update tests for any behavior change.
- Update relevant docs (`README.md`, `docs/*.md`) when CLI/JSON behavior
  changes — documentation must always describe actually-implemented
  behavior, not aspirational behavior.
