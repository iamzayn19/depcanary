import type { Detector, Evidence, PackageContext, Signal } from "./types.js";
import { collectModuleBindings, resolveCallTarget } from "./module-bindings.js";
import { walk } from "../analysis/ast.js";
import { fileLine, newIdentities, snippetFor, staticStringValue } from "./util.js";

const HTTP_MEMBERS = new Set(["request", "get"]);
const NET_MODULES = new Set(["http", "https", "net", "tls"]);

function hostFromUrl(literal: string): string | undefined {
  try {
    return new URL(literal).host;
  } catch {
    return undefined;
  }
}

export const networkDetector: Detector = {
  code: "DC004",
  title: "New outbound network capability or destination",
  defaultSeverity: "medium",
  summary:
    "Flags newly introduced use of fetch/http/https/net/tls/WebSocket, extracting literal " +
    "hosts where statically known; reports 'dynamic destination' otherwise.",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    for (const file of ctx.files) {
      if (!file.ast) continue;
      const bindings = collectModuleBindings(file.ast);
      walk(file.ast.program, (node) => {
        if (
          node.type === "NewExpression" &&
          node.callee.type === "Identifier" &&
          node.callee.name === "WebSocket"
        ) {
          const arg = node.arguments[0];
          const literal = arg ? staticStringValue(arg) : undefined;
          const host = literal ? hostFromUrl(literal) : undefined;
          signals.push({
            identity: `net:websocket:${host ?? "dynamic"}`,
            detail: host ?? "dynamic destination",
            confidence: host ? "high" : "medium",
            ...fileLine(file, node),
            snippet: snippetFor(file.source, node)
          });
          return;
        }

        if (node.type === "CallExpression") {
          if (node.callee.type === "Identifier" && node.callee.name === "fetch") {
            const arg = node.arguments[0];
            const literal = arg ? staticStringValue(arg) : undefined;
            const host = literal ? hostFromUrl(literal) : undefined;
            signals.push({
              identity: `net:fetch:${host ?? "dynamic"}`,
              detail: host ?? "dynamic destination",
              confidence: host ? "high" : "medium",
              ...fileLine(file, node),
              snippet: snippetFor(file.source, node)
            });
            return;
          }

          const target = resolveCallTarget(node, bindings);
          if (target && NET_MODULES.has(target.module)) {
            if (
              (target.module === "http" || target.module === "https") &&
              HTTP_MEMBERS.has(target.member)
            ) {
              const arg = node.arguments[0];
              const literal =
                (arg ? staticStringValue(arg) : undefined) ??
                (arg && arg.type === "ObjectExpression" ? undefined : undefined);
              const host = literal ? hostFromUrl(literal) : undefined;
              signals.push({
                identity: `net:${target.module}.${target.member}:${host ?? "dynamic"}`,
                detail: host ?? "dynamic destination",
                confidence: host ? "high" : "medium",
                ...fileLine(file, node),
                snippet: snippetFor(file.source, node)
              });
            } else if (target.module === "net" && target.member === "connect") {
              signals.push({
                identity: `net:net.connect:dynamic`,
                detail: "dynamic destination",
                confidence: "medium",
                ...fileLine(file, node),
                snippet: snippetFor(file.source, node)
              });
            } else if (target.module === "tls" && target.member === "connect") {
              signals.push({
                identity: `net:tls.connect:dynamic`,
                detail: "dynamic destination",
                confidence: "medium",
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
          code: "DC004",
          severity: "medium",
          confidence: sig.confidence ?? "medium",
          title:
            sig.detail === "dynamic destination"
              ? "New network capability (dynamic destination)"
              : `New network destination: ${sig.detail}`,
          description:
            sig.detail === "dynamic destination"
              ? "This version introduces a new outbound network call whose destination cannot be " +
                "statically determined."
              : `This version introduces a new outbound network call to "${sig.detail}", which was not ` +
                "contacted by the previous version.",
          file: sig.file,
          line: sig.line,
          column: sig.column,
          newValue: sig.detail,
          snippet: sig.snippet
        }) satisfies Evidence
    );
  }
};
