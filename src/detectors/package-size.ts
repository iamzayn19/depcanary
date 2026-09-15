import type { Detector, Evidence, PackageContext, Signal } from "./types.js";

export const packageSizeDetector: Detector = {
  code: "DC011",
  title: "Large package size/file-count jump",
  defaultSeverity: "low",
  summary:
    "Contextual: compares packed size and file count using relative + absolute thresholds so small " +
    "packages don't trigger noisy warnings.",

  analyze(ctx: PackageContext): Signal[] {
    return [
      { identity: "size:bytes", detail: String(ctx.totalBytes), confidence: "high" },
      { identity: "size:files", detail: String(ctx.packedFiles.length), confidence: "high" }
    ];
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    const oldBytes = Number(oldSignals.find((s) => s.identity === "size:bytes")?.detail ?? 0);
    const newBytes = Number(newSignals.find((s) => s.identity === "size:bytes")?.detail ?? 0);
    const oldFiles = Number(oldSignals.find((s) => s.identity === "size:files")?.detail ?? 0);
    const newFiles = Number(newSignals.find((s) => s.identity === "size:files")?.detail ?? 0);

    const findings: Evidence[] = [];
    const byteGrowth =
      oldBytes > 0 ? (newBytes - oldBytes) / oldBytes : newBytes > 0 ? Infinity : 0;
    const absoluteJump = newBytes - oldBytes > 5 * 1024 * 1024; // 5MB
    const relativeJump = byteGrowth > 3 && newBytes > 100 * 1024; // +300% and not trivially small

    if (absoluteJump || relativeJump) {
      findings.push({
        code: "DC011",
        severity: absoluteJump && relativeJump ? "medium" : "low",
        confidence: "high",
        title: "Large package size increase",
        description: `Packed size grew from ${oldBytes} to ${newBytes} bytes.`,
        oldValue: oldBytes,
        newValue: newBytes
      });
    }
    const fileGrowth =
      oldFiles > 0 ? (newFiles - oldFiles) / oldFiles : newFiles > 0 ? Infinity : 0;
    if (fileGrowth > 3 && newFiles > 50) {
      findings.push({
        code: "DC011",
        severity: "low",
        confidence: "high",
        title: "Large file-count increase",
        description: `Packed file count grew from ${oldFiles} to ${newFiles}.`,
        oldValue: oldFiles,
        newValue: newFiles
      });
    }
    return findings;
  }
};
