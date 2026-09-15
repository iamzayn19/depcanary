import { ALL_DETECTORS } from "../detectors/index.js";
import type { Evidence } from "../detectors/types.js";
import type { BehaviorSnapshot } from "./snapshot.js";
import { severityRank } from "../constants.js";

export function diffSnapshots(oldSnap: BehaviorSnapshot, newSnap: BehaviorSnapshot): Evidence[] {
  const findings: Evidence[] = [];
  for (const detector of ALL_DETECTORS) {
    const oldSignals = oldSnap.signals[detector.code] ?? [];
    const newSignals = newSnap.signals[detector.code] ?? [];
    const evidence = detector.diff(oldSignals, newSignals);
    findings.push(...evidence);
  }

  // Deterministic ordering: severity desc, then code, then file, then line.
  findings.sort((a, b) => {
    const sevDiff = severityRank(b.severity) - severityRank(a.severity);
    if (sevDiff !== 0) return sevDiff;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const fa = a.file ?? "";
    const fb = b.file ?? "";
    if (fa !== fb) return fa < fb ? -1 : 1;
    return (a.line ?? 0) - (b.line ?? 0);
  });

  return findings;
}
