# Risk scoring

This document describes exactly what `src/scoring/score.ts` and
`src/scoring/severity.ts` compute. There are no hidden weights beyond what
is written here.

## 1. Base points per severity

Each `Evidence` finding has a `severity` (`info` | `low` | `medium` | `high`
| `critical`), which maps to base points:

| Severity | Base points |
| -------- | ----------- |
| info     | 2           |
| low      | 5           |
| medium   | 12          |
| high     | 25          |
| critical | 40          |

## 2. Diminishing weight within a detector code

Findings are grouped by detector code (`DC001`, `DC002`, ...). Within a
code's group, findings are sorted by severity (highest first); the first
finding counts at full weight, and every additional finding of the _same_
code counts at 30% weight. This prevents, for example, three separate
`DC004` (new network destination) findings from tripling the score simply
because a package calls `fetch()` at three call sites for the same new
capability.

## 3. Cap on summed base score

The sum across all detector-code groups is capped at **80** before any
combination bonus is applied.

## 4. Combination bonus

Three code groups are defined for combination purposes:

- **Lifecycle**: `DC001`
- **Execution**: `DC002`, `DC003`, `DC007`
- **Exfiltration**: `DC004`, `DC005`, `DC006`

If findings from **all three** groups are present in the same comparison,
a **+20** bonus is applied (this is the "new postinstall + shell execution +
secret/network access" combination called out as CRITICAL-worthy in the
product spec). If findings from **exactly two** of the three groups are
present, a **+10** bonus is applied. Otherwise no bonus.

This exists specifically so that a package which merely gains a network
call, or merely gains a `child_process` import, does not casually reach a
CRITICAL score — but a package that gains a coordinated lifecycle → execute
→ exfiltrate chain does.

## 5. Final clamp and band

`score = round(min(base, 80) + bonus)`, clamped to `[0, 100]`.

| Score  | Band     |
| ------ | -------- |
| 0–19   | low      |
| 20–39  | moderate |
| 40–69  | high     |
| 70–100 | critical |

## Determinism

Scoring is a pure function of the finding set: same findings in, same score
out, every time. No randomness, no network calls, no LLM involvement.

## What the score is (and isn't) for

The score is a fast triage aid for `--fail-on` gating and at-a-glance
comparison in `--all` output. **The evidence is the product** — always
review the actual findings, not just the number, before deciding whether an
update is safe to install.
