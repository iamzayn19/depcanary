import { describe, it, expect } from "vitest";
import { toHumanReport } from "../../src/cli/format-human.js";
import { toJsonReport, toJsonError } from "../../src/cli/format-json.js";
import type { ComparisonResult } from "../../src/analysis/analyzer.js";

function makeResult(overrides: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    package: "widget",
    from: { name: "widget", version: "1.0.0" },
    to: { name: "widget", version: "1.1.0" },
    score: 61,
    risk: "high",
    findings: [
      {
        code: "DC001",
        severity: "high",
        confidence: "high",
        title: "New lifecycle script",
        description: "This version introduces a postinstall script.",
        file: "package.json",
        line: 3,
        newValue: "postinstall: node scripts/setup.js\x1b[31mFAKE\x07"
      }
    ],
    summary: {
      files: { from: 81, to: 85 },
      packedSize: { from: 412_000, to: 438_000 },
      dependencies: { added: 1, removed: 0 }
    },
    ...overrides
  } as ComparisonResult;
}

describe("toHumanReport", () => {
  it("renders findings with color disabled and no raw ANSI", () => {
    const out = toHumanReport(makeResult(), false);
    expect(out).toContain("DepCanary");
    expect(out).toContain("widget 1.0.0 → 1.1.0");
    expect(out).toContain("Risk  HIGH  61/100");
    expect(out).toContain("DC001");
    expect(out).toContain("Review this update before installing it.");

    expect(out).not.toMatch(/\x1b\[31m|\x07/);
  });

  it("does not throw when color is requested (picocolors itself gates on TTY detection)", () => {
    // toHumanReport(..., true) requests color; picocolors independently disables
    // ANSI output when stdout is not a TTY (as under the test runner), which is
    // the same safety property --no-color/NO_COLOR rely on for CI. We only
    // assert the call is safe and the content is still present.
    const out = toHumanReport(makeResult(), true);
    expect(out).toContain("DC001");
  });

  it("renders a clean report with no findings", () => {
    const out = toHumanReport(makeResult({ findings: [], score: 0, risk: "low" }), false);
    expect(out).toContain("No newly introduced risky behavior detected.");
    expect(out).not.toContain("Review this update");
  });

  it("renders a finding with no file, an oldValue, and a snippet fallback", () => {
    const out = toHumanReport(
      makeResult({
        findings: [
          {
            code: "DC012",
            severity: "low",
            confidence: "medium",
            title: "Publisher identity changed",
            description: "publisher differs",
            oldValue: "alice",
            newValue: "bob"
          },
          {
            code: "DC009",
            severity: "medium",
            confidence: "low",
            title: "Possible obfuscated payload",
            description: "entropy spike",
            snippet: "aGVsbG8gd29ybGQ="
          }
        ]
      }),
      false
    );
    expect(out).toContain("alice");
    expect(out).toContain("bob");
    expect(out).toContain("aGVsbG8gd29ybGQ=");
  });

  it("formats byte sizes across ranges", () => {
    const small = toHumanReport(
      makeResult({
        summary: {
          files: { from: 1, to: 1 },
          packedSize: { from: 10, to: 20 },
          dependencies: { added: 0, removed: 0 }
        }
      }),
      false
    );
    expect(small).toContain("10 B");
    const mb = toHumanReport(
      makeResult({
        summary: {
          files: { from: 1, to: 1 },
          packedSize: { from: 1_500_000, to: 2_000_000 },
          dependencies: { added: 0, removed: 0 }
        }
      }),
      false
    );
    expect(mb).toContain("MB");
  });
});

describe("toJsonReport / toJsonError", () => {
  it("produces valid JSON with schemaVersion and sanitized fields", () => {
    const json = toJsonReport(makeResult());
    const parsed = JSON.parse(json) as { schemaVersion: number; findings: { newValue: string }[] };
    expect(parsed.schemaVersion).toBe(1);

    expect(parsed.findings[0]!.newValue).not.toMatch(/\x1b\[31m|\x07/);
  });

  it("omits optional fields (file/line/column/oldValue/snippet) when absent", () => {
    const json = toJsonReport(
      makeResult({
        findings: [
          {
            code: "DC004",
            severity: "medium",
            confidence: "low",
            title: "New network destination",
            description: "dynamic destination"
          }
        ]
      })
    );
    const parsed = JSON.parse(json) as { findings: Record<string, unknown>[] };
    const f = parsed.findings[0]!;
    expect("file" in f).toBe(false);
    expect("line" in f).toBe(false);
    expect("oldValue" in f).toBe(false);
    expect("snippet" in f).toBe(false);
  });

  it("includes numeric oldValue/newValue and a snippet without sanitizing numbers", () => {
    const json = toJsonReport(
      makeResult({
        findings: [
          {
            code: "DC011",
            severity: "low",
            confidence: "high",
            title: "Package size jump",
            description: "size grew",
            oldValue: 100,
            newValue: 500,
            snippet: "some\x1b[31mevidence"
          }
        ]
      })
    );
    const parsed = JSON.parse(json) as {
      findings: { oldValue: number; newValue: number; snippet: string }[];
    };
    expect(parsed.findings[0]!.oldValue).toBe(100);
    expect(parsed.findings[0]!.newValue).toBe(500);

    expect(parsed.findings[0]!.snippet).not.toMatch(/\x1b/);
  });

  it("produces a machine readable error payload", () => {
    const json = toJsonError("UsageError", "bad \x1b[31minput\x07");
    const parsed = JSON.parse(json) as {
      schemaVersion: number;
      error: { kind: string; message: string };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.error.kind).toBe("UsageError");

    expect(parsed.error.message).not.toMatch(/\x1b\[31m|\x07/);
  });
});
