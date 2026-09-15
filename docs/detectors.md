# Detectors

All detector codes are stable and public. This table and the per-detector
sections below are kept consistent with what `depcanary explain <CODE>`
prints — run that command for the canonical short-form text.

| Code  | Detector                                          | Default severity                              | What it means                                                                                                           |
| ----- | ------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| DC001 | Lifecycle script introduced or materially changed | high (critical for shell/downloader patterns) | New/changed install-time script (`preinstall`/`install`/`postinstall`/`prepare`/`prepublish*`)                          |
| DC002 | New child process execution capability            | medium–high                                   | New `child_process` import or call (`exec`, `execFile`, `spawn`, `spawnSync`, `execSync`, `fork`)                       |
| DC003 | New shell execution / shell mode                  | high                                          | New `exec`/`execSync` call, or `spawn`/`spawnSync` with `{ shell: true }`                                               |
| DC004 | New outbound network capability or destination    | medium                                        | New `fetch`/`http(s).request`/`http(s).get`/`net.connect`/`tls.connect`/`WebSocket` usage, or a new literal destination |
| DC005 | New sensitive environment-variable access         | medium–high                                   | New read of a credential-shaped env var                                                                                 |
| DC006 | New sensitive filesystem access                   | varies                                        | New reference/read/write of a credential/config path (`.npmrc`, `.ssh`, `.aws`, `.netrc`, ...)                          |
| DC007 | New dynamic code execution                        | high                                          | New `eval`, `new Function`, `vm.runInNewContext`/`runInThisContext`/`compileFunction`                                   |
| DC008 | New executable/native artifact                    | high                                          | New `.node`/`.wasm`/ELF/Mach-O/PE file packed into the tarball                                                          |
| DC009 | Suspicious obfuscation delta                      | medium (high if combined with dynamic code)   | New high-entropy / base64-like / hex-escaped payload                                                                    |
| DC010 | New risky dependency source                       | medium                                        | New dependency declared via git/HTTP URL, `file:`, or `link:` instead of a registry version                             |
| DC011 | Large package size/file-count jump                | low–medium                                    | Packed size or file count grew sharply, using both relative and absolute thresholds                                     |
| DC012 | Publisher identity changed                        | low                                           | The npm account that published the new version differs from the one that published the old version                      |

Every detector obeys the same rule: **a signal present in both the old and
new snapshot is never reported as "introduced."** This is the single most
important behavior in the product and is covered by dedicated tests for
every code.

---

## DC001 — Lifecycle script introduced or materially changed

**Catches:** a `preinstall`/`install`/`postinstall`/`prepare`/`prepublish`/
`prepublishOnly` script that is new in the compared version, or whose
contents changed materially.

**Why it matters:** npm may execute lifecycle scripts during installation
depending on client configuration — a new `postinstall` is one of the most
direct ways an update can run arbitrary code on a developer's or CI
machine.

**Severity logic:** `critical` when the new/changed script content itself
looks like it invokes a shell or a network downloader; `high` otherwise.
Ordinary `test`/`build`/`lint` scripts are not lifecycle-risk scripts and
are ignored.

**False positives:** a legitimate `postinstall` that compiles a native
addon still fires — DepCanary cannot distinguish "legitimate build step" from
"malicious payload" by content alone; it flags the _capability_, and expects
human review.

**False negatives:** a lifecycle script present unchanged since the
compared "old" version does not fire, even if it is itself risky — that's
existing behavior, not something this update introduced.

## DC002 — New child process execution capability

**Catches:** a new `child_process`/`node:child_process` import or a new call
to `exec`/`execFile`/`spawn`/`spawnSync`/`execSync`/`fork`.

**Severity logic:** `high` for a confirmed call, `medium` for an import
without an observed call (lower confidence — the capability exists but
isn't demonstrably exercised in analyzed files).

**False positives:** none by import alone beyond the "capability exists"
framing above — a benign CLI tool that has always shelled out is not
flagged unless that capability is new in the compared version.

**False negatives:** dynamically resolved module names
(`require(someVariable)`) are not tracked.

## DC003 — New shell execution / shell mode

**Catches:** `exec(...)`/`execSync(...)`, or `spawn`/`spawnSync` called with
`{ shell: true }` — the strongest process-execution primitive, since it
invokes a full shell rather than a specific binary with an argument array.

**Overlaps DC002** intentionally — a call site can produce both a DC002 and
a DC003 finding; the scoring layer's diminishing-weight-per-code and
combination-bonus design (see `docs/scoring.md`) prevents this from
double-inflating the score disproportionately.

## DC004 — New outbound network capability or destination

**Catches:** new `fetch`, `http(s).request`/`.get`, `net.connect`,
`tls.connect`, `WebSocket` usage, and statically-literal URL/host
destinations.

**Severity logic:** `medium`.

**Reporting:** when a destination is a literal, it's reported by
normalized host/origin (retaining the full literal in evidence). When a
destination is built dynamically, evidence explicitly says "dynamic
destination" rather than guessing — DepCanary never resolves or contacts any
discovered destination.

**False negatives:** dynamically constructed URLs with no static literal
component are recorded as capability-only, not destination-specific.

## DC005 — New sensitive environment-variable access

**Catches:** new `process.env.X` reads where `X` is a known high-value
credential name (`NPM_TOKEN`, `NODE_AUTH_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`,
`GOOGLE_APPLICATION_CREDENTIALS`, `CI_JOB_TOKEN`, `SSH_AUTH_SOCK`) or
matches a secret-shaped pattern (`*_TOKEN`, `*_SECRET`, `*_PASSWORD`,
`*_API_KEY`, `AZURE_*`).

**Explicitly excluded** as benign, never flagged: `NODE_ENV`, `CI`, `DEBUG`,
`HOME`, `PATH`, `TERM`, `LANG`, `PWD`, `SHELL`, `USER`.

**Severity logic:** `high` for exact known high-value names, `medium` for
pattern matches.

## DC006 — New sensitive filesystem access

**Catches:** new references to credential/config paths (`.npmrc`, `~/.ssh`,
`id_rsa`, `id_ed25519`, `.aws`, `.config/gcloud`, `.git-credentials`,
`.netrc`, and similar), including common constructions like
`path.join(os.homedir(), ".npmrc")`.

**Differentiates** reference vs. confirmed read/write where the surrounding
call is a known filesystem API (`fs.readFile`/`readFileSync`/`open`/
`createReadStream`, etc.) — a bare string literal that happens to match a
sensitive pattern (e.g. in test fixture text) is lower-confidence contextual
evidence than a literal passed directly into a known read/write API.

## DC007 — New dynamic code execution

**Catches:** new `eval(...)`, `new Function(...)`/`Function(...)`,
`vm.runInNewContext`/`runInThisContext`/`compileFunction`.

**AST-based**, so `// eval("...")` in a comment or `"use eval here"` in a
string literal does not fire — only actual call expressions.

## DC008 — New executable/native artifact

**Catches:** a newly packed `.node`/`.wasm` file, or a file whose magic
bytes identify it as an ELF, Mach-O, or PE binary, regardless of extension.

**Never executes** the artifact — detection is extension/magic-byte and
archive-metadata only.

## DC009 — Suspicious obfuscation delta

**Catches (heuristic):** a newly introduced high-entropy or base64-like/
hex-escaped string payload, especially one combined with `eval`/dynamic
execution.

**Severity logic:** `medium` normally, `high` when combined with a strong
signal (e.g. co-occurring `eval`).

**Explicitly not claimed:** DepCanary never prints "malware detected" —
output language is "possible newly introduced obfuscated payload." Minified
code and legitimately-encoded data (e.g. embedded binary assets as base64)
can trigger this; it is the highest-false-positive detector by design and is
weighted accordingly (never critical on its own).

## DC010 — New risky dependency source

**Catches:** a newly added `dependencies`/`optionalDependencies` entry using
a git URL, GitHub tarball URL, plain HTTP URL, `file:`, or `link:` source
instead of a normal registry semver range.

**Not flagged:** an ordinary new semver dependency — that's summarized as
informational dependency-count delta, not a finding.

## DC011 — Large package size/file-count jump

**Catches:** a large relative _and_ absolute jump in packed size or file
count between versions (both thresholds must be meaningful — e.g. 1 KB → 3
KB is a 200% relative jump but trivial in absolute terms, and is not
flagged).

**Severity logic:** `medium` when both relative and absolute jumps are
large, `low` otherwise. Always contextual evidence, never the primary
signal in a report.

## DC012 — Publisher identity changed

**Catches:** the registry-reported publishing account differs between the
old and new version.

**Only fires when registry data is reliably available** — if the configured
registry doesn't expose per-version publisher identity, this detector is
silently omitted rather than guessing.

**Explicitly not proof of compromise** — maintainer teams legitimately
rotate who publishes. Always `low` severity, a review signal only.
