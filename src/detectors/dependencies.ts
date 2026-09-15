import type { Detector, Evidence, PackageContext, Signal } from "./types.js";

function riskySource(spec: string): string | undefined {
  if (/^git(\+[a-z]+)?:\/\//.test(spec) || /^git@/.test(spec)) return "git URL";
  if (/^https?:\/\/.*\.tar\.gz/.test(spec) || /github\.com\/.*\/tarball\//.test(spec))
    return "tarball URL";
  if (/^https?:\/\//.test(spec)) return "HTTP URL";
  if (spec.startsWith("file:")) return "file:";
  if (spec.startsWith("link:")) return "link:";
  return undefined;
}

export const dependenciesDetector: Detector = {
  code: "DC010",
  title: "New risky dependency source",
  defaultSeverity: "medium",
  summary:
    "Flags newly introduced dependencies pinned to git/tarball/HTTP/file:/link: sources rather than " +
    "a normal registry semver range, and summarizes dependency count deltas.",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    const deps = {
      ...(ctx.manifest["dependencies"] as Record<string, string> | undefined),
      ...(ctx.manifest["optionalDependencies"] as Record<string, string> | undefined)
    };
    for (const [name, spec] of Object.entries(deps)) {
      signals.push({ identity: `dep:${name}`, detail: spec, confidence: "high" });
      const risky = riskySource(spec);
      if (risky) {
        signals.push({
          identity: `dep-risky:${name}`,
          detail: `${risky}::${spec}`,
          confidence: "high"
        });
      }
    }
    return signals;
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    const findings: Evidence[] = [];
    const oldRisky = new Map(
      oldSignals.filter((s) => s.identity.startsWith("dep-risky:")).map((s) => [s.identity, s])
    );
    for (const sig of newSignals) {
      if (!sig.identity.startsWith("dep-risky:")) continue;
      if (oldRisky.has(sig.identity)) continue;
      const [risky, spec] = (sig.detail ?? "::").split("::");
      const name = sig.identity.slice("dep-risky:".length);
      findings.push({
        code: "DC010",
        severity: "medium",
        confidence: "high",
        title: `New dependency from a non-registry source: ${name}`,
        description:
          `The dependency "${name}" is now sourced via a ${risky} ("${spec}") instead of a normal ` +
          "registry semver range. This changes supply-chain trust assumptions for installs.",
        newValue: spec
      });
    }
    return findings;
  }
};
