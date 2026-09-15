# Security model

DepCanary analyzes untrusted, potentially hostile input by design: arbitrary
published npm tarballs. This document describes the threat model, the
guarantees DepCanary seeks to provide, and its explicit non-goals.

## Threat model

The following inputs must be treated as potentially malicious:

- registry metadata (packument JSON, including publisher/dist fields);
- the package name/spec supplied by the user or resolved from a project;
- tarball filenames and internal archive entry paths;
- tarball path components (traversal, absolute paths, Windows drive paths,
  symlink/hardlink targets);
- source file text (arbitrary bytes, invalid Unicode, adversarial syntax
  designed to break a parser);
- giant or pathologically-structured files/archives (memory/CPU
  exhaustion);
- archive metadata (declared vs. actual entry sizes, entry counts).

## Guarantees sought

- **Target package code is never executed.** No lifecycle script, no
  package binary, no `require`/`import` of package code, no `npm install
<target>`/`npm exec`/`npx <target>`, no test/build command from the
  target package. DepCanary's own source is grep-auditable for this
  property — the only process execution anywhere in `src/` is DepCanary's
  own network fetch and filesystem operations, never anything derived from
  target package content.
- **Extraction cannot escape the temporary extraction root.** Every archive
  entry path is validated before being written; `../` traversal, absolute
  paths, Windows drive-letter paths, and symlink/hardlink targets that would
  resolve outside the extraction root are rejected. Extraction always
  happens into a freshly created, uniquely named OS temp directory, which is
  always removed in a `finally` block.
- **Integrity is verified when the registry provides it.** A `dist.integrity`
  mismatch aborts the comparison before any extraction/analysis happens.
- **Analysis has explicit resource limits.** Archive file count, total
  extracted bytes, per-entry bytes, per-file AST parse size, evidence
  snippet length, network timeout, redirect count, and download concurrency
  are all named constants (`src/constants.ts`) enforced in the pipeline;
  reaching a limit produces a diagnostic, not a crash or hang.
- **Network credentials are not leaked cross-origin.** DepCanary only
  contacts the configured registry origin and tarball hosts it references;
  it does not forward any credential to an unrelated host.
- **Output escaping prevents terminal-control abuse where practical.**
  Evidence text (script values, source snippets, file paths) originates from
  attacker-controlled package content and is sanitized before being written
  to the terminal or included in JSON output, to prevent a hostile package
  from injecting terminal control sequences into a developer's or CI
  system's output.
- **A malformed or adversarial file does not abort the whole comparison.**
  A parser failure on one file is recorded as a diagnostic; the rest of the
  package is still analyzed.

## Non-goals

- **DepCanary cannot prove a package is safe.** The absence of a finding
  means "no detector-recognized new risky capability was found," not
  "this update is safe."
- **DepCanary cannot detect every obfuscated or dynamically-constructed
  payload.** Static analysis has fundamental limits; a sufficiently evasive
  payload (e.g. behavior gated behind a runtime condition DepCanary cannot
  evaluate, or a destination built from opaque logic) will not be
  statically recoverable.
- **DepCanary does not replace package-manager signature/provenance
  verification.** npm provenance and package signatures answer "did this
  artifact really come from the claimed source," a different and
  complementary question to "what behavior changed in this artifact."
- **DepCanary is not a vulnerability/CVE scanner.** It does not consult a
  vulnerability database and makes no claim about known CVEs — see
  `npm audit` for that.
