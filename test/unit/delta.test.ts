import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../../src/analysis/delta.js";
import type { BehaviorSnapshot } from "../../src/analysis/snapshot.js";

function snapshot(signals: BehaviorSnapshot["signals"]): BehaviorSnapshot {
  return {
    coordinate: { name: "pkg", version: "1.0.0" },
    manifest: {},
    packedFiles: [],
    totalBytes: 0,
    signals,
    diagnostics: []
  };
}

describe("diffSnapshots ordering", () => {
  it("orders findings by severity, then code, then file, then line", () => {
    const oldSnap = snapshot({ DC012: [{ identity: "publisher", detail: "alice" }] });
    const newSnap = snapshot({
      DC005: [
        { identity: "env:B_SECRET", detail: "B_SECRET", file: "b.js", line: 5 },
        { identity: "env:A_SECRET", detail: "A_SECRET", file: "a.js", line: 10 },
        { identity: "env:A_SECRET2", detail: "A_SECRET2", file: "a.js", line: 2 }
      ],
      DC012: [{ identity: "publisher", detail: "bob" }]
    });
    const findings = diffSnapshots(oldSnap, newSnap);
    const dc005 = findings.filter((f) => f.code === "DC005");
    expect(dc005.map((f) => f.file)).toEqual(["a.js", "a.js", "b.js"]);
    expect(dc005[0]?.line).toBe(2);
    expect(dc005[1]?.line).toBe(10);
    // DC012 (low severity) should sort after DC005 (high-severity secret access).
    const dc005Index = findings.findIndex((f) => f.code === "DC005");
    const dc012Index = findings.findIndex((f) => f.code === "DC012");
    expect(dc005Index).toBeGreaterThanOrEqual(0);
    expect(dc012Index).toBeGreaterThanOrEqual(0);
    expect(dc005Index).toBeLessThan(dc012Index);
  });

  it("returns no findings for two identical snapshots (core invariant)", () => {
    const snap = snapshot({
      DC002: [{ identity: "cp:child_process", detail: "import" }]
    });
    expect(diffSnapshots(snap, snap)).toHaveLength(0);
  });
});
