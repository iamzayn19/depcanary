import { SCHEMA_VERSION } from "../constants.js";
import type { ComparisonResult } from "../analysis/analyzer.js";
import { sanitizeForTerminal } from "../analysis/evidence.js";

export function toJsonReport(result: ComparisonResult): string {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    package: result.package,
    from: { version: result.from.version },
    to: { version: result.to.version },
    risk: { score: result.score, band: result.risk },
    summary: result.summary,
    findings: result.findings.map((f) => ({
      code: f.code,
      severity: f.severity,
      confidence: f.confidence,
      title: sanitizeForTerminal(f.title, 300),
      description: sanitizeForTerminal(f.description, 1000),
      ...(f.file ? { file: sanitizeForTerminal(f.file, 300) } : {}),
      ...(f.line !== undefined ? { line: f.line } : {}),
      ...(f.column !== undefined ? { column: f.column } : {}),
      ...(f.oldValue !== undefined
        ? {
            oldValue: typeof f.oldValue === "string" ? sanitizeForTerminal(f.oldValue) : f.oldValue
          }
        : {}),
      ...(f.newValue !== undefined
        ? {
            newValue: typeof f.newValue === "string" ? sanitizeForTerminal(f.newValue) : f.newValue
          }
        : {}),
      ...(f.snippet ? { snippet: sanitizeForTerminal(f.snippet) } : {})
    }))
  };
  return JSON.stringify(payload, null, 2);
}

export function toJsonError(kind: string, message: string): string {
  return JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, error: { kind, message: sanitizeForTerminal(message, 1000) } },
    null,
    2
  );
}
