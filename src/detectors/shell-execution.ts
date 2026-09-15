import type { Detector, Evidence, PackageContext, Signal } from "./types.js";
import { collectModuleBindings, resolveCallTarget } from "./module-bindings.js";
import { walk } from "../analysis/ast.js";
import { fileLine, newIdentities, snippetFor } from "./util.js";

const DIRECT_SHELL = new Set(["exec", "execSync"]);
const SPAWN_LIKE = new Set(["spawn", "spawnSync"]);

export const shellExecutionDetector: Detector = {
  code: "DC003",
  title: "New shell execution / shell mode",
  defaultSeverity: "high",
  summary:
    "Flags the strongest process-execution primitives: exec()/execSync() (always a shell), and " +
    "spawn()/spawnSync() invoked with { shell: true }.",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    for (const file of ctx.files) {
      if (!file.ast) continue;
      const bindings = collectModuleBindings(file.ast);
      walk(file.ast.program, (node) => {
        const target = resolveCallTarget(node, bindings);
        if (!target || target.module !== "child_process") return;
        if (node.type !== "CallExpression") return;

        if (DIRECT_SHELL.has(target.member)) {
          signals.push({
            identity: `shell:${target.member}`,
            confidence: "high",
            ...fileLine(file, node),
            snippet: snippetFor(file.source, node)
          });
        } else if (SPAWN_LIKE.has(target.member)) {
          const optsArg = node.arguments[node.arguments.length - 1];
          if (optsArg && optsArg.type === "ObjectExpression") {
            const shellProp = optsArg.properties.find(
              (p) =>
                p.type === "ObjectProperty" && p.key.type === "Identifier" && p.key.name === "shell"
            );
            if (
              shellProp &&
              shellProp.type === "ObjectProperty" &&
              shellProp.value.type === "BooleanLiteral" &&
              shellProp.value.value === true
            ) {
              signals.push({
                identity: `shell:${target.member}:shellTrue`,
                confidence: "high",
                ...fileLine(file, node),
                snippet: snippetFor(file.source, node)
              });
            }
          }
        }
      });
    }
    return signals;
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    return newIdentities(oldSignals, newSignals).map(
      (sig) =>
        ({
          code: "DC003",
          severity: "high",
          confidence: "high",
          title: "New shell execution primitive",
          description:
            "This version introduces a call that spawns a system shell " +
            "(exec/execSync, or spawn with shell:true). This is a strong execution primitive " +
            "commonly abused to run arbitrary attacker-controlled commands.",
          file: sig.file,
          line: sig.line,
          column: sig.column,
          snippet: sig.snippet
        }) satisfies Evidence
    );
  }
};
