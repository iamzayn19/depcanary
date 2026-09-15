# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- `depcanary diff <pkg@old> <pkg@new>` and the `depcanary <pkg@old> <pkg@new>`
  shorthand for comparing two published versions of the same package.
- `depcanary <pkg>` to compare a project's locked version against the latest
  registry version.
- `depcanary --all` to scan all direct dependency updates available to the
  current project (`--include-dev` to include dev dependencies).
- `depcanary doctor` to validate the local operating environment.
- `depcanary explain <CODE>` to print detector documentation from the CLI.
- Twelve behavioral-delta detectors: `DC001` (lifecycle scripts), `DC002`
  (child process capability), `DC003` (shell execution), `DC004` (network
  capability/destination), `DC005` (sensitive environment variables),
  `DC006` (sensitive filesystem paths), `DC007` (dynamic code execution),
  `DC008` (executable/native artifacts), `DC009` (obfuscation heuristics),
  `DC010` (risky dependency sources), `DC011` (package size/file-count
  jumps), `DC012` (publisher identity changes).
- Deterministic, capped/category-aware risk scoring (`src/scoring/`), fully
  documented in `docs/scoring.md`.
- `--json` output with an explicit `schemaVersion`, deterministic ordering,
  and clean stdout/stderr separation.
- `--fail-on <level>` CI-friendly exit-code gating, and defined exit codes
  (`0`/`1`/`2`).
- Registry client with configurable registry URL, `dist.integrity`
  verification (aborts on mismatch), bounded timeouts/redirects.
- Hardened tarball extraction defending against path traversal, absolute
  paths, and symlink/hardlink escapes, with explicit resource limits on
  archive size, file count, and per-file parse size.
- Terminal-output sanitization against control-sequence injection from
  attacker-controlled package content.
- A local, on-disk tarball/metadata cache (`--no-cache` / `--cache-dir`).
- Public library API: `compare(from, to, options)` returning a
  `ComparisonResult`.

### Security

- Target package source code, lifecycle scripts, and binaries are never
  executed at any point in the analysis pipeline.
