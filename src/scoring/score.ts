import type { Evidence } from "../detectors/types.js";
import type { Severity } from "../constants.js";
import { bandForScore, type RiskBand } from "./severity.js";

/**
 * Base points per severity. See docs/scoring.md for the full documented algorithm.
 */
const BASE_POINTS: Record<Severity, number> = {
  info: 2,
  low: 5,
  medium: 12,
  high: 25,
  critical: 40
};

/** Codes that represent related "install-time execution chain" behavior for combination bonuses. */
const LIFECYCLE_CODES = new Set(["DC001"]);
const EXECUTION_CODES = new Set(["DC002", "DC003", "DC007"]);
const EXFIL_CODES = new Set(["DC004", "DC005", "DC006"]);

export interface ScoreResult {
  score: number;
  band: RiskBand;
}

/**
 * Deterministic, capped/category-aware scoring.
 *
 * 1. Group findings by detector code. Within a code, the first finding counts at
 *    full weight and each additional finding of the same code counts at 30% weight
 *    (diminishing returns) so that e.g. three DC004 findings do not triple-count.
 * 2. Sum weighted points across codes, capped at 80.
 * 3. Apply a documented combination bonus (max +20) when findings span the
 *    lifecycle -> execution -> exfiltration chain simultaneously, since that
 *    combination is materially more dangerous than any single category alone.
 * 4. Clamp the final score to [0, 100].
 */
export function computeScore(findings: Evidence[]): ScoreResult {
  const byCode = new Map<string, Evidence[]>();
  for (const f of findings) {
    const arr = byCode.get(f.code) ?? [];
    arr.push(f);
    byCode.set(f.code, arr);
  }

  let base = 0;
  const presentCodes = new Set<string>();
  for (const [code, evs] of byCode) {
    presentCodes.add(code);
    const sorted = [...evs].sort((a, b) => BASE_POINTS[b.severity] - BASE_POINTS[a.severity]);
    sorted.forEach((ev, idx) => {
      const weight = idx === 0 ? 1 : 0.3;
      base += BASE_POINTS[ev.severity] * weight;
    });
  }
  base = Math.min(base, 80);

  const hasLifecycle = [...presentCodes].some((c) => LIFECYCLE_CODES.has(c));
  const hasExecution = [...presentCodes].some((c) => EXECUTION_CODES.has(c));
  const hasExfil = [...presentCodes].some((c) => EXFIL_CODES.has(c));

  let bonus = 0;
  if (hasLifecycle && hasExecution && hasExfil) bonus = 20;
  else if (
    (hasLifecycle && hasExecution) ||
    (hasLifecycle && hasExfil) ||
    (hasExecution && hasExfil)
  )
    bonus = 10;

  const score = Math.max(0, Math.min(100, Math.round(base + bonus)));
  return { score, band: bandForScore(score) };
}
