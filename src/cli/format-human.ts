import pc from "picocolors";
import type { ComparisonResult } from "../analysis/analyzer.js";
import type { Evidence } from "../detectors/types.js";
import { sanitizeForTerminal } from "../analysis/evidence.js";

const SEVERITY_LABEL: Record<string, string> = {
  info: "INFO",
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  critical: "CRIT"
};

function colorFor(severity: string, text: string, colorEnabled: boolean): string {
  if (!colorEnabled) return text;
  switch (severity) {
    case "critical":
      return pc.bold(pc.red(text));
    case "high":
      return pc.red(text);
    case "medium":
      return pc.yellow(text);
    case "low":
      return pc.cyan(text);
    default:
      return pc.gray(text);
  }
}

function renderFinding(f: Evidence, colorEnabled: boolean): string[] {
  const lines: string[] = [];
  const label = colorFor(
    f.severity,
    SEVERITY_LABEL[f.severity] ?? f.severity.toUpperCase(),
    colorEnabled
  );
  const title = sanitizeForTerminal(f.title, 300);
  lines.push(
    `${label.padEnd(colorEnabled ? label.length + (5 - SEVERITY_LABEL[f.severity]!.length) : 5)}  ${f.code}  ${title}`
  );
  if (f.file) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    lines.push(`  ${sanitizeForTerminal(loc, 300)}`);
  }
  if (f.oldValue !== undefined) {
    lines.push(`  - ${sanitizeForTerminal(String(f.oldValue))}`);
  }
  if (f.newValue !== undefined) {
    lines.push(`  + ${sanitizeForTerminal(String(f.newValue))}`);
  } else if (f.snippet) {
    lines.push(`  + ${sanitizeForTerminal(f.snippet)}`);
  }
  return lines;
}

export function toHumanReport(result: ComparisonResult, colorEnabled: boolean): string {
  const lines: string[] = [];
  lines.push("DepCanary");
  lines.push("");
  lines.push(`${result.package} ${result.from.version} → ${result.to.version}`);
  lines.push("");
  const bandLabel = result.risk.toUpperCase();
  const riskLine = `Risk  ${bandLabel}  ${result.score}/100`;
  lines.push(colorFor(severityForBand(result.risk), riskLine, colorEnabled));
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("No newly introduced risky behavior detected.");
  } else {
    lines.push("NEW BEHAVIOR");
    lines.push("");
    for (const f of result.findings) {
      lines.push(...renderFinding(f, colorEnabled));
      lines.push("");
    }
  }

  lines.push("PACKAGE DELTA");
  lines.push("");
  lines.push(`  files       ${result.summary.files.from} → ${result.summary.files.to}`);
  lines.push(
    `  packed size ${formatBytes(result.summary.packedSize.from)} → ${formatBytes(result.summary.packedSize.to)}`
  );
  lines.push(
    `  dependencies +${result.summary.dependencies.added} / -${result.summary.dependencies.removed}`
  );
  lines.push("");

  if (result.findings.length > 0) {
    lines.push("Review this update before installing it.");
  }

  return lines.join("\n");
}

function severityForBand(band: string): string {
  switch (band) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
      return "medium";
    default:
      return "low";
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
