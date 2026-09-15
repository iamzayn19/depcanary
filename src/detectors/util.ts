import type { Node } from "@babel/types";
import { sanitizeForTerminal } from "../analysis/evidence.js";
import type { FileContext, Signal } from "./types.js";

export function snippetFor(source: string, node: Node): string {
  const start = node.start ?? 0;
  const end = Math.min(node.end ?? start + 80, start + 200);
  return sanitizeForTerminal(source.slice(start, end));
}

export function locOf(node: Node): { line?: number; column?: number } {
  if (node.loc) {
    return { line: node.loc.start.line, column: node.loc.start.column + 1 };
  }
  return {};
}

/** Deduplicates signals by identity, keeping the first occurrence's location. */
export function dedupeByIdentity(signals: Signal[]): Signal[] {
  const seen = new Map<string, Signal>();
  for (const s of signals) {
    if (!seen.has(s.identity)) seen.set(s.identity, s);
  }
  return [...seen.values()];
}

export function newIdentities(oldSignals: Signal[], newSignals: Signal[]): Signal[] {
  const oldSet = new Set(oldSignals.map((s) => s.identity));
  return dedupeByIdentity(newSignals).filter((s) => !oldSet.has(s.identity));
}

/** Very small static string resolver: literal strings and simple template literals with no expressions. */
export function staticStringValue(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "StringLiteral") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

export function fileLine(
  ctx: FileContext,
  node: Node
): { file: string; line?: number; column?: number } {
  const loc = locOf(node);
  return { file: ctx.relPath, ...loc };
}
