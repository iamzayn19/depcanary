import type { Detector, Evidence, PackageContext, Signal } from "./types.js";
import { collectModuleBindings, resolveCallTarget } from "./module-bindings.js";
import { walk } from "../analysis/ast.js";
import { fileLine, newIdentities, snippetFor } from "./util.js";

const VM_MEMBERS = new Set(["runInNewContext", "runInThisContext", "compileFunction"]);

export const dynamicCodeDetector: Detector = {
  code: "DC007",
  title: "New dynamic code execution",
  defaultSeverity: "high",
  summary:
    "Flags newly introduced eval(...), new Function(...), and node:vm code-generation APIs (AST-based only).",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    for (const file of ctx.files) {
      if (!file.ast) continue;
      const bindings = collectModuleBindings(file.ast);
      walk(file.ast.program, (node) => {
        if (
          node.type === "CallExpression" &&
          node.callee.type === "Identifier" &&
          node.callee.name === "eval"
        ) {
          signals.push({
            identity: "dyn:eval",
            confidence: "high",
            ...fileLine(file, node),
            snippet: snippetFor(file.source, node)
          });
        }
        if (
          (node.type === "NewExpression" || node.type === "CallExpression") &&
          node.callee.type === "Identifier" &&
          node.callee.name === "Function"
        ) {
          signals.push({
            identity: "dyn:Function",
            confidence: "high",
            ...fileLine(file, node),
            snippet: snippetFor(file.source, node)
          });
        }
        if (node.type === "CallExpression") {
          const target = resolveCallTarget(node, bindings);
          if (target && target.module === "vm" && VM_MEMBERS.has(target.member)) {
            signals.push({
              identity: `dyn:vm.${target.member}`,
              confidence: "high",
              ...fileLine(file, node),
              snippet: snippetFor(file.source, node)
            });
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
          code: "DC007",
          severity: "high",
          confidence: "high",
          title: "New dynamic code execution",
          description:
            "This version introduces a new call to eval(), the Function constructor, or a node:vm " +
            "code-generation API. These can execute arbitrary strings as code at runtime.",
          file: sig.file,
          line: sig.line,
          column: sig.column,
          snippet: sig.snippet
        }) satisfies Evidence
    );
  }
};
