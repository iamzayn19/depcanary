import { parse } from "@babel/parser";
import type { File, Node } from "@babel/types";

export interface ParsedFile {
  ok: true;
  ast: File;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult = ParsedFile | ParseFailure;

/**
 * Parses JS/TS/JSX/TSX source tolerantly. Never executes the source. Parse
 * failures are reported, not thrown, so one malformed file cannot abort
 * analysis of the rest of a package.
 */
export function parseSourceSafely(source: string, relPath: string): ParseResult {
  const isTs = /\.(ts|tsx|cts|mts)$/i.test(relPath);
  const isJsx = /\.(jsx|tsx)$/i.test(relPath) || !isTs;
  try {
    const ast = parse(source, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: [
        ...(isTs ? (["typescript"] as const) : ([] as const)),
        ...(isJsx ? (["jsx"] as const) : ([] as const)),
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "decorators-legacy",
        "dynamicImport",
        "exportDefaultFrom",
        "topLevelAwait",
        "optionalChaining",
        "nullishCoalescingOperator"
      ]
    });
    return { ok: true, ast };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Minimal, dependency-free generic AST walker. Avoids pulling in @babel/traverse
 * (a much heavier dependency) while still visiting every node reachable from the
 * root. Detectors call `visit` for each node and may inspect `node.type`.
 */
export function walk(
  node: Node | null | undefined,
  visit: (node: Node, parent: Node | null) => void,
  parent: Node | null = null
): void {
  if (!node || typeof node !== "object" || typeof (node as Node).type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "range" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && typeof (item as Node).type === "string") {
          walk(item as Node, visit, node);
        }
      }
    } else if (value && typeof value === "object" && typeof (value as Node).type === "string") {
      walk(value as Node, visit, node);
    }
  }
}
