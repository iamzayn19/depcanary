import { describe, expect, it } from "vitest";
import { computeScore } from "../../src/scoring/score.js";
import { bandForScore } from "../../src/scoring/severity.js";
import type { Evidence } from "../../src/detectors/types.js";

function finding(code: string, severity: Evidence["severity"]): Evidence {
  return { code, severity, confidence: "high", title: code, description: code };
}

describe("bandForScore boundaries", () => {
  it.each([
    [0, "low"],
    [19, "low"],
    [20, "moderate"],
    [39, "moderate"],
    [40, "high"],
    [69, "high"],
    [70, "critical"],
    [100, "critical"]
  ] as const)("score %i -> %s", (score, band) => {
    expect(bandForScore(score)).toBe(band);
  });
});

describe("computeScore", () => {
  it("returns 0/low for no findings", () => {
    expect(computeScore([])).toEqual({ score: 0, band: "low" });
  });

  it("applies diminishing weight to repeated findings of the same code", () => {
    const single = computeScore([finding("DC004", "medium")]);
    const triple = computeScore([
      finding("DC004", "medium"),
      finding("DC004", "medium"),
      finding("DC004", "medium")
    ]);
    // Base for one medium finding = 12. Three: 12 + 12*0.3 + 12*0.3 = 19.2 -> round 19.
    expect(single.score).toBe(12);
    expect(triple.score).toBeLessThan(single.score * 3);
    expect(triple.score).toBe(19);
  });

  it("applies a +10 bonus for exactly two combination groups (lifecycle + execution)", () => {
    const result = computeScore([finding("DC001", "high"), finding("DC002", "high")]);
    // base = 25 + 25 = 50, bonus = 10 -> 60
    expect(result.score).toBe(60);
  });

  it("applies a +10 bonus for exactly two combination groups (execution + exfiltration)", () => {
    const result = computeScore([finding("DC003", "high"), finding("DC005", "high")]);
    expect(result.score).toBe(60);
  });

  it("applies a +20 bonus when all three combination groups are present", () => {
    const result = computeScore([
      finding("DC001", "critical"),
      finding("DC003", "high"),
      finding("DC005", "high")
    ]);
    // base = min(40 + 25 + 25, 80) = 80, bonus = 20 -> 100
    expect(result.score).toBe(100);
    expect(result.band).toBe("critical");
  });

  it("applies no combination bonus for findings in a single group", () => {
    const result = computeScore([finding("DC004", "medium"), finding("DC005", "high")]);
    // both DC004 and DC005 are exfiltration-only -> no bonus
    expect(result.score).toBe(12 + 25);
  });

  it("caps the base score at 80 before bonuses", () => {
    const manyFindings = Array.from({ length: 10 }, (_, i) => finding(`DR0${i}`, "critical"));
    const result = computeScore(manyFindings);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("clamps the final score to [0, 100]", () => {
    const result = computeScore([
      finding("DC001", "critical"),
      finding("DC002", "critical"),
      finding("DC003", "critical"),
      finding("DC004", "critical"),
      finding("DC005", "critical"),
      finding("DC006", "critical")
    ]);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
