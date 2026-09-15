import type { Detector, Evidence, PackageContext, Signal } from "./types.js";

const LONG_LINE_THRESHOLD = 2000;
const BASE64_BLOB_RE = /['"`][A-Za-z0-9+/]{300,}={0,2}['"`]/;
const HEX_BLOB_RE = /(\\x[0-9a-fA-F]{2}){40,}/;

export const obfuscationDetector: Detector = {
  code: "DC009",
  title: "Suspicious obfuscation delta",
  defaultSeverity: "medium",
  summary:
    "Heuristic: flags a material increase in long single lines, large base64/hex-encoded blobs, or " +
    "eval combined with encoded content. Never asserts malware.",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    for (const file of ctx.files) {
      const longLines = file.source
        .split("\n")
        .filter((l) => l.length > LONG_LINE_THRESHOLD).length;
      if (longLines > 0) {
        signals.push({
          identity: `obf:longlines:${file.relPath}`,
          detail: String(longLines),
          file: file.relPath,
          confidence: "low"
        });
      }
      if (BASE64_BLOB_RE.test(file.source)) {
        signals.push({
          identity: `obf:base64:${file.relPath}`,
          file: file.relPath,
          confidence: "low"
        });
      }
      if (HEX_BLOB_RE.test(file.source)) {
        signals.push({
          identity: `obf:hex:${file.relPath}`,
          file: file.relPath,
          confidence: "low"
        });
      }
      if (
        /\beval\s*\(/.test(file.source) &&
        (BASE64_BLOB_RE.test(file.source) || HEX_BLOB_RE.test(file.source))
      ) {
        signals.push({
          identity: `obf:eval-encoded:${file.relPath}`,
          file: file.relPath,
          confidence: "medium"
        });
      }
    }
    return signals;
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    const oldSet = new Set(oldSignals.map((s) => s.identity));
    return newSignals
      .filter((s) => !oldSet.has(s.identity))
      .map((sig) => {
        const strong = sig.identity.includes("eval-encoded");
        return {
          code: "DC009",
          severity: strong ? "high" : "medium",
          confidence: sig.confidence ?? "low",
          title: "Possible newly introduced obfuscated payload",
          description:
            "This file newly exhibits characteristics sometimes associated with obfuscated payloads " +
            "(very long lines, large base64/hex-like blobs, or eval combined with encoded content). " +
            "This is heuristic; generated/minified/bundled code can trigger it without being malicious.",
          file: sig.file
        } satisfies Evidence;
      });
  }
};
