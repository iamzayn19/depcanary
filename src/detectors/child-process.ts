import type { Detector, Evidence, PackageContext, Signal } from "./types.js";
import { collectModuleBindings, resolveCallTarget } from "./module-bindings.js";
import { walk } from "../analysis/ast.js";
import { fileLine, newIdentities, snippetFor } from "./util.js";

const CP_MEMBERS = new Set([
  "exec",
  "execFile",
  "spawn",
  "spawnSync",
  "execSync",
  "execFileSync",
  "fork"
]);

export const childProcessDetector: Detector = {
  code: "DC002",
  title: "New child process execution capability",
  defaultSeverity: "high",
  summary:
    "Flags newly introduced references to node:child_process APIs (import/require and confirmed calls).",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    for (const file of ctx.files) {
      if (!file.ast) continue;
      const bindings = collectModuleBindings(file.ast);

      for (const [, mod] of bindings.namespace) {
        if (mod === "child_process") {
          signals.push({
            identity: "cp:import",
            detail: "import",
            confidence: "low",
            file: file.relPath
          });
        }
      }
      for (const [, b] of bindings.named) {
        if (b.module === "child_process") {
          signals.push({
            identity: `cp:import:${b.imported}`,
            detail: `import:${b.imported}`,
            confidence: "low",
            file: file.relPath
          });
        }
      }

      walk(file.ast.program, (node) => {
        const target = resolveCallTarget(node, bindings);
        if (target && target.module === "child_process" && CP_MEMBERS.has(target.member)) {
          signals.push({
            identity: `cp:call:${target.member}`,
            detail: `call:${target.member}`,
            confidence: "high",
            ...fileLine(file, node),
            snippet: snippetFor(file.source, node)
          });
        }
      });
    }
    return signals;
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    const introduced = newIdentities(oldSignals, newSignals);
    return introduced.map((sig) => {
      const isCall = sig.identity.startsWith("cp:call:");
      return {
        code: "DC002",
        severity: isCall ? "high" : "medium",
        confidence: isCall ? "high" : "low",
        title: isCall
          ? `New child_process call: ${sig.detail?.replace("call:", "")}`
          : "New child_process import",
        description: isCall
          ? "This version calls a node:child_process API that was not used in the previous version. " +
            "This grants the package the ability to run arbitrary OS commands."
          : "This version references node:child_process for the first time. This alone does not prove " +
            "execution, but it introduces the capability.",
        file: sig.file,
        line: sig.line,
        column: sig.column,
        snippet: sig.snippet
      } satisfies Evidence;
    });
  }
};
