[![npm version](https://img.shields.io/npm/v/@iamzayn19/depcanary.svg)](https://www.npmjs.com/package/@iamzayn19/depcanary)
[![CI](https://github.com/iamzayn19/depcanary/actions/workflows/ci.yml/badge.svg)](https://github.com/iamzayn19/depcanary/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/@iamzayn19/depcanary.svg)](https://www.npmjs.com/package/@iamzayn19/depcanary)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# DepCanary

> **See risky dependency updates before they land.**

DepCanary compares two published npm package versions and shows risky behavior
that appears in the **new** version but not the old one — install scripts,
process execution, secret access, sensitive file reads, new network
destinations, executable artifacts, and suspicious obfuscation.

```console
$ npx @iamzayn19/depcanary some-package@2.4.7 some-package@2.4.8

DepCanary

some-package 2.4.7 → 2.4.8

Risk  CRITICAL  84/100

CRITICAL  DC001  New lifecycle script: postinstall
  package.json
  + "postinstall": "node scripts/setup.js"

HIGH      DC005  New sensitive environment access: NPM_TOKEN
  scripts/setup.js:9
  + process.env.NPM_TOKEN

HIGH      DC006  New sensitive file read: ~/.npmrc
  scripts/setup.js:12
  + fs.readFileSync(...)

MED       DC004  New network destination
  scripts/setup.js:21
  + https://example.invalid

Review this update before installing it.
```

_(Synthetic example — `some-package` is not a real npm package.)_

**No account. No telemetry. No LLM. Target package code is never executed.**

## Why DepCanary exists

`npm install` and `npm update` trust that a new version behaves like the old
one. Most of the time it does. Occasionally it doesn't: a maintainer's
account is compromised, a dependency is taken over, or a "patch" release
quietly adds a `postinstall` script that phones home. Many dependency-security workflows focus on known vulnerabilities.
DepCanary focuses specifically on behavioral changes between two published package versions.

DepCanary answers one narrow question:

> **What risky behavior did this update introduce that was not present in
> the previous published version?**

A package that has used `child_process` for ten releases should not be
flagged on every release just because it uses `child_process`. A release
that newly introduces `child_process.exec` with a `postinstall` script and a
new network destination should be flagged loudly. That's the whole product:
**diff package behavior, not just code.**

DepCanary is intentionally **not** a malware scanner, a CVE/vulnerability
database, a popularity score, an `npm audit` replacement, a lockfile linter,
an AI assistant, or a sandbox that executes third-party code.

## Install / usage

```console
npx @iamzayn19/depcanary lodash@4.17.20 lodash@4.17.21
```

Or install it globally / as a dev dependency:

```console
npm install -g @iamzayn19/depcanary
depcanary lodash@4.17.20 lodash@4.17.21
```

```console
npm install --save-dev @iamzayn19/depcanary
```

Requires Node.js `>=22`.

## Quick start

```console
# Explicit version comparison
depcanary diff axios@1.6.0 axios@1.7.0

# Shorthand — equivalent to the above
depcanary axios@1.6.0 axios@1.7.0

# Compare a project's currently locked version against the latest
depcanary axios

# Scan every direct dependency update available to this project
depcanary --all

# Explain a detector
depcanary explain DC001
```

## How behavioral delta differs from normal scanners

```text
OLD PUBLISHED TARBALL
        ↓ extract signals
OLD BEHAVIOR SNAPSHOT

NEW PUBLISHED TARBALL
        ↓ extract signals
NEW BEHAVIOR SNAPSHOT

NEW − OLD
        ↓
BEHAVIORAL DELTA
        ↓
EVIDENCE + SEVERITY + EXPLANATION
```

DepCanary never runs `npm install <target>`, `npx <target>`, lifecycle
scripts, or any code from either package. It downloads the two published
tarballs from the configured registry, extracts them into an isolated
temporary directory, statically analyzes the files, and computes what's
genuinely **new** in the second version. See
[`docs/security-model.md`](docs/security-model.md) for the full threat
model.

## Commands

| Command                              | Description                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `depcanary diff <pkg@old> <pkg@new>` | Compare two published versions of the same package                                |
| `depcanary <pkg@old> <pkg@new>`      | Shorthand for `diff`                                                              |
| `depcanary <pkg>`                    | Compare the project's locked version of `pkg` against the latest registry version |
| `depcanary --all`                    | Analyze updates available for the current project's direct dependencies           |
| `depcanary doctor`                   | Validate DepCanary's own operating environment                                    |
| `depcanary explain <CODE>`           | Explain a detector code (e.g. `DC001`)                                            |

### Global options

```text
--json               Output machine-readable JSON to stdout
--no-color            Disable colored output (also respects NO_COLOR)
--quiet               Suppress non-essential stderr output
--fail-on <level>     Exit 1 if a finding meets this severity
                      (info|low|medium|high|critical)
--registry <url>      Registry URL to use
--cache-dir <path>    Cache directory to use
--no-cache             Disable the tarball cache
--version              Output the version number
--help                 Show help
```

`--all` additionally supports `--include-dev` to include dev dependencies.

## Exit codes

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| `0`  | Analysis completed and `--fail-on` threshold was not met                       |
| `1`  | Analysis completed and a finding met or exceeded `--fail-on`                   |
| `2`  | Usage error, package/version not found, registry failure, or integrity failure |

```console
depcanary diff pkg@1.0.0 pkg@1.1.0 --fail-on high
```

## Detector table

| Code  | Detector                                       | Default severity | What it means                                                                        |
| ----- | ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| DC001 | Lifecycle script introduced or changed         | high–critical    | New/changed `preinstall`/`install`/`postinstall`/`prepare`/`prepublish*`             |
| DC002 | New child process execution capability         | medium–high      | New `child_process` import/call (`exec`, `spawn`, `fork`, ...)                       |
| DC003 | New shell execution / shell mode               | high             | New `exec`/`execSync` or `spawn(..., { shell: true })`                               |
| DC004 | New outbound network capability or destination | medium           | New `fetch`/`http(s)`/`net`/`tls`/`WebSocket` usage or destination                   |
| DC005 | New sensitive environment-variable access      | varies           | New read of a credential-shaped env var (`NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY`, ...)  |
| DC006 | New sensitive filesystem access                | varies           | New reference/read/write of `.npmrc`, `.ssh`, `.aws`, `.netrc`, etc.                 |
| DC007 | New dynamic code execution                     | high             | New `eval`, `new Function`, `vm.runInNewContext`, etc.                               |
| DC008 | New executable/native artifact                 | high             | New `.node`/`.wasm`/ELF/Mach-O/PE file packed into the tarball                       |
| DC009 | Suspicious obfuscation delta                   | medium–high      | New high-entropy/base64-like payload, especially combined with `eval`                |
| DC010 | New risky dependency source                    | medium           | New dependency using a git/HTTP/`file:`/`link:` source instead of a registry version |
| DC011 | Large package size/file-count jump             | low–medium       | Packed size or file count grew sharply                                               |
| DC012 | Publisher identity changed                     | low              | The npm account that published the version changed                                   |

Full details, evidence shape, caveats, and false-positive/negative notes for
every detector are in [`docs/detectors.md`](docs/detectors.md). Run
`depcanary explain <CODE>` for the same information from the CLI.

## Risk scoring

Findings are grouped by detector code (diminishing weight for repeated
findings of the same code), summed and capped, then a documented combination
bonus is applied when findings span the lifecycle → execution →
exfiltration chain together. The full deterministic algorithm — every
weight, cap, and bonus — is written out with no hidden numbers in
[`docs/scoring.md`](docs/scoring.md).

| Score  | Band     |
| ------ | -------- |
| 0–19   | low      |
| 20–39  | moderate |
| 40–69  | high     |
| 70–100 | critical |

## Project-wide `--all` usage

```console
$ depcanary --all --fail-on high

17 direct dependency updates

CRITICAL  foo       2.1.0 → 2.1.1   82
HIGH      bar       4.0.2 → 4.1.0   55
LOW       zod       4.2.1 → 4.2.2    4
```

`--all` reads `package-lock.json` (npm) read-only, analyzes **direct**
production dependencies by default (`--include-dev` adds dev dependencies),
uses bounded concurrency, and never runs `npm install`/`npm update`. See
[`docs/architecture.md`](docs/architecture.md) for the exact lockfile
support matrix.

## CI usage

```yaml
- name: Review dependency update
  run: npx @iamzayn19/depcanary axios@1.13.1 axios@1.13.2 --fail-on high

- name: Scan direct dependency updates
  run: npx @iamzayn19/depcanary --all --fail-on high
```

DepCanary produces no interactive prompts, no spinners in non-TTY
environments, and clean stdout/stderr separation, so it's safe to run
directly in CI.

## JSON usage

`--json` writes valid JSON and nothing else to stdout; diagnostics go to
stderr.

```json
{
  "schemaVersion": 1,
  "package": "axios",
  "from": { "version": "1.13.1" },
  "to": { "version": "1.13.2" },
  "risk": { "score": 61, "band": "high" },
  "findings": []
}
```

Output is deterministic: repeated runs against the same tarballs produce
byte-identical JSON, and no absolute temporary-directory paths leak into the
result.

## Security model

- Target package code, lifecycle scripts, and binaries are **never
  executed**.
- Tarballs are extracted only into a fresh, isolated temporary directory,
  hardened against path traversal, absolute paths, and symlink/hardlink
  escapes.
- `dist.integrity` is verified when the registry provides it; a mismatch
  aborts the comparison.
- Explicit resource limits bound archive size/file count, per-file parse
  size, snippet length, redirects, and network timeouts.
- Evidence snippets are sanitized against terminal control-sequence
  injection.

Full threat model, guarantees, and explicit non-goals:
[`docs/security-model.md`](docs/security-model.md).

## Privacy

DepCanary downloads package metadata/tarballs from the configured npm
registry. Analysis happens locally. DepCanary has no telemetry and does not
upload package source to any DepCanary server — there is no DepCanary
server.

## Supported Node versions

Node.js `22.x` (LTS), `24.x` (LTS), `26.x` (Current). `engines.node` is set
to `>=22`.

## Limitations

DepCanary performs static analysis on published tarball contents. It:

- cannot resolve dynamically constructed strings (a network destination
  built at runtime from concatenated variables is reported as a "dynamic
  destination", not a specific URL);
- cannot detect every obfuscated or encoded payload;
- cannot execute code, so behavior gated behind runtime conditions it can't
  evaluate is not observed;
- does not analyze the full transitive dependency tree by default — `--all`
  covers direct dependencies only in `0.1.0`;
- does not replace `npm audit` (known-vulnerability matching) or npm
  provenance/signature verification (artifact-origin proof) — it solves a
  different, complementary problem.

DepCanary never claims to catch all malicious packages and never claims zero
false negatives.

## False positives / false negatives

Detectors are heuristic by design. A detector firing means "this specific
capability appears to be newly introduced — review it," not "this package is
malicious." DepCanary deliberately avoids reporting _unchanged_ risky
behavior as new (a package that has always used `child_process` will not be
flagged for it on every release) — see
[`docs/detectors.md`](docs/detectors.md) for per-detector caveats.

## Comparison with `npm audit`

|                   | `npm audit`                                              | DepCanary                                              |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Question answered | Does this dependency tree contain known vulnerabilities? | What new behavior did this specific update introduce?  |
| Data source       | Vulnerability database                                   | The two published tarballs themselves                  |
| Scope             | Whole dependency tree                                    | One package version pair (or direct deps with `--all`) |

They are complementary, not competing — `npm audit` is unaffected by (and
still valuable alongside) DepCanary.

## Development

```console
git clone https://github.com/iamzayn19/depcanary.git
cd depcanary
npm ci
npm run check   # format check, lint, typecheck, tests, build
npm run smoke   # pack + install into a clean temp project + run it
```

See [`docs/architecture.md`](docs/architecture.md) and
[`docs/testing.md`](docs/testing.md) for internals.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Security reporting

See [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
