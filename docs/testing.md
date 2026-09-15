# Testing

DepCanary's test suite is layered, matching the different kinds of
correctness the product depends on.

```console
npm test              # unit + integration + cli + security
npm run test:unit
npm run test:integration
npm run test:cli
npm run test:coverage # same as `npm test`, with coverage reporting/thresholds
npm run test:live     # manual/optional, hits the real npm registry — never run in CI
npm run smoke         # builds, packs, installs the tarball into a clean temp project, runs it
```

## `test/unit/`

Fast, isolated tests of individual modules: package-spec parsing,
integrity verification (valid/corrupted/malformed-integrity-string cases),
per-detector signal extraction and delta semantics (introduced/unchanged/
removed/benign-to-risky, CommonJS and ESM forms, comment/string
false-positive avoidance), scoring, project/lockfile discovery, error
classes, output formatting.

## `test/integration/`

End-to-end comparisons driven against a local, in-process fake npm
registry (see `test/helpers/fake-registry.ts`) — never the real
`registry.npmjs.org`. Exercises the full pipeline: spec parsing → registry
resolution → download → integrity → extraction → analysis → delta →
scoring → result, using synthetic before/after tarballs.

## `test/security/`

Adversarial archive-extraction tests: path traversal, absolute paths,
Windows drive paths, symlink/hardlink escape attempts, oversized
archives/entries. These fixtures are constructed as raw tar entries (not
via the `tar` library's own packing, which would sanitize hostile paths
before they ever reached the archive) so the test genuinely exercises
`src/archive/safety.ts` against byte-for-byte hostile input rather than
input the packing library already cleaned up.

## `test/cli/`

Subprocess tests: the actual built CLI binary is spawned as a child
process (not called as an in-process function) and its stdout/stderr/exit
code are asserted — `--help`, `--version`, `diff`, the bare-argument
shorthand, `--json` (valid JSON, `schemaVersion` present, nothing else on
stdout), `--no-color`/`NO_COLOR`, `--fail-on` at each severity boundary,
mismatched package names, package/version not found, registry failure,
corrupted tarball (integrity abort), `doctor`, `explain`.

## Fixture philosophy

See `CONTRIBUTING.md` — every detector fixture must prove the introduced /
unchanged / removed invariant, not just the positive "finding produced"
case.

## Coverage

Coverage thresholds are enforced in `vitest.config.ts` and are treated as a
guardrail, not a target to game — they are raised only when real tests
support the higher number, and never lowered to force a build green.
Archive safety, integrity verification, package-spec parsing, and detector
delta logic are treated as security-sensitive and held to the highest
coverage expectations.

## What isn't covered by automated tests

`npm run test:live` performs a small number of comparisons against real,
historical, exact-version pairs of well-known public packages. It's a
manual sanity check, tolerates network absence, never asserts exact
findings (since packages evolve), and is never part of `npm test` or CI.
