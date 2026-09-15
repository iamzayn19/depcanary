import type { File, Node } from "@babel/types";
import { walk } from "../analysis/ast.js";
import { staticStringValue } from "./util.js";

export interface ModuleBindings {
  /** local name -> { module, imported } for named imports/requires, e.g. `exec` -> child_process.exec */
  named: Map<string, { module: string; imported: string }>;
  /** local name -> module for `import * as cp from "x"` / `const cp = require("x")` (whole-module binding) */
  namespace: Map<string, string>;
}

function normalizeModule(mod: string): string {
  return mod.startsWith("node:") ? mod.slice("node:".length) : mod;
}

export function collectModuleBindings(ast: File): ModuleBindings {
  const named = new Map<string, { module: string; imported: string }>();
  const namespace = new Map<string, string>();

  walk(ast.program, (node: Node) => {
    if (node.type === "ImportDeclaration") {
      const mod = normalizeModule(node.source.value);
      for (const spec of node.specifiers) {
        if (spec.type === "ImportSpecifier") {
          const imported =
            spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
          named.set(spec.local.name, { module: mod, imported });
        } else if (
          spec.type === "ImportNamespaceSpecifier" ||
          spec.type === "ImportDefaultSpecifier"
        ) {
          namespace.set(spec.local.name, mod);
        }
      }
    }
    if (node.type === "VariableDeclarator" && node.init) {
      const init = node.init;
      // const x = require("mod")
      if (
        init.type === "CallExpression" &&
        init.callee.type === "Identifier" &&
        init.callee.name === "require"
      ) {
        const arg = init.arguments[0];
        const mod = arg ? staticStringValue(arg) : undefined;
        if (mod) {
          const normMod = normalizeModule(mod);
          if (node.id.type === "Identifier") {
            namespace.set(node.id.name, normMod);
          } else if (node.id.type === "ObjectPattern") {
            for (const prop of node.id.properties) {
              if (
                prop.type === "ObjectProperty" &&
                prop.key.type === "Identifier" &&
                prop.value.type === "Identifier"
              ) {
                named.set(prop.value.name, { module: normMod, imported: prop.key.name });
              }
            }
          }
        }
      }
    }
  });

  return { named, namespace };
}

/**
 * Resolves a call expression's target as { module, member } when statically known.
 * Handles: exec(...) [imported named], cp.exec(...) [namespace], require("mod").exec(...) [inline chain].
 */
export function resolveCallTarget(
  node: Node,
  bindings: ModuleBindings
): { module: string; member: string } | undefined {
  if (node.type !== "CallExpression") return undefined;
  const callee = node.callee;
  if (callee.type === "Identifier") {
    const b = bindings.named.get(callee.name);
    if (b) return { module: b.module, member: b.imported };
    return undefined;
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    const obj = callee.object;
    if (obj.type === "Identifier") {
      const mod = bindings.namespace.get(obj.name);
      if (mod) return { module: mod, member: callee.property.name };
    }
    if (
      obj.type === "CallExpression" &&
      obj.callee.type === "Identifier" &&
      obj.callee.name === "require"
    ) {
      const arg = obj.arguments[0];
      const mod = arg ? staticStringValue(arg) : undefined;
      if (mod) return { module: normalizeModule(mod), member: callee.property.name };
    }
  }
  return undefined;
}
