import type { Detector, Evidence, PackageContext, Signal } from "./types.js";
import { sanitizeForTerminal } from "../analysis/evidence.js";

const RISKY_LIFECYCLE_HOOKS = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepublishOnly",
  "prepare"
];

const SHELL_DOWNLOADER_RE = /(curl|wget)\s+.*(\|\s*sh|\|\s*bash)|https?:\/\//i;

export const lifecycleScriptsDetector: Detector = {
  code: "DC001",
  title: "Lifecycle script introduced or materially changed",
  defaultSeverity: "high",
  summary:
    "Flags newly introduced or materially changed install-time lifecycle scripts (preinstall/install/postinstall/prepare/prepublish*).",

  analyze(ctx: PackageContext): Signal[] {
    const scripts = (ctx.manifest["scripts"] as Record<string, unknown> | undefined) ?? {};
    const signals: Signal[] = [];
    for (const hook of RISKY_LIFECYCLE_HOOKS) {
      const value = scripts[hook];
      if (typeof value === "string" && value.trim().length > 0) {
        signals.push({
          identity: `script:${hook}:${value}`,
          detail: value,
          file: "package.json",
          snippet: sanitizeForTerminal(`"${hook}": "${value}"`)
        });
      }
    }
    return signals;
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    const oldByHook = new Map<string, Signal>();
    for (const s of oldSignals) oldByHook.set(s.identity.split(":")[1]!, s);
    const newByHook = new Map<string, Signal>();
    for (const s of newSignals) newByHook.set(s.identity.split(":")[1]!, s);

    const findings: Evidence[] = [];
    for (const [hook, sig] of newByHook) {
      const previous = oldByHook.get(hook);
      if (!previous) {
        const risky = SHELL_DOWNLOADER_RE.test(sig.detail ?? "");
        findings.push({
          code: "DC001",
          severity: risky ? "critical" : "high",
          confidence: "high",
          title: `New lifecycle script: ${hook}`,
          description:
            `This version introduces a "${hook}" script. npm may execute lifecycle scripts ` +
            `during installation depending on client configuration. Review what this script does ` +
            `before installing.`,
          file: "package.json",
          newValue: sig.detail,
          snippet: sig.snippet
        });
      } else if (previous.detail !== sig.detail) {
        const risky = SHELL_DOWNLOADER_RE.test(sig.detail ?? "");
        findings.push({
          code: "DC001",
          severity: risky ? "critical" : "high",
          confidence: "high",
          title: `Lifecycle script changed: ${hook}`,
          description: `The "${hook}" script's contents changed materially between versions.`,
          file: "package.json",
          oldValue: previous.detail,
          newValue: sig.detail,
          snippet: sig.snippet
        });
      }
    }
    return findings;
  }
};
