import type { Node } from "@babel/types";
import type { Detector, Evidence, PackageContext, Signal } from "./types.js";
import { collectModuleBindings, resolveCallTarget } from "./module-bindings.js";
import { walk } from "../analysis/ast.js";
import { fileLine, newIdentities, snippetFor, staticStringValue } from "./util.js";

/**
 * Collects string-literal arguments from a node, descending into common path-construction
 * calls (path.join(...), path.resolve(...)) so constructions like
 * path.join(os.homedir(), ".npmrc") are recognized even though the literal is not a direct
 * argument of the outer call.
 */
function collectPathLiterals(node: Node | null | undefined, out: string[]): void {
  if (!node) return;
  const direct = staticStringValue(node);
  if (direct) {
    out.push(direct);
    return;
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "path" &&
    (node.callee.property.name === "join" || node.callee.property.name === "resolve")
  ) {
    for (const arg of node.arguments) collectPathLiterals(arg, out);
  }
}

const SENSITIVE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\.npmrc$/i, label: ".npmrc" },
  { re: /\.ssh(\/|$)/i, label: ".ssh" },
  { re: /id_rsa$/i, label: "id_rsa" },
  { re: /id_ed25519$/i, label: "id_ed25519" },
  { re: /\.aws(\/|$)/i, label: ".aws" },
  { re: /\.config\/gcloud/i, label: ".config/gcloud" },
  { re: /\.git-credentials$/i, label: ".git-credentials" },
  { re: /\.netrc$/i, label: ".netrc" },
  { re: /\.docker\/config\.json$/i, label: ".docker/config.json" }
];

const READ_FNS = new Set(["readFile", "readFileSync", "open", "openSync", "createReadStream"]);
const WRITE_FNS = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream"
]);

function classify(literal: string): string | undefined {
  for (const { re, label } of SENSITIVE_PATTERNS) {
    if (re.test(literal)) return label;
  }
  return undefined;
}

export const sensitivePathsDetector: Detector = {
  code: "DC006",
  title: "New sensitive filesystem access",
  defaultSeverity: "high",
  summary:
    "Flags newly introduced references to credential/config file paths (.npmrc, .ssh, .aws, .netrc, " +
    "docker config, git credentials), distinguishing read/write from mere reference where the call is known.",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    for (const file of ctx.files) {
      if (!file.ast) continue;
      const bindings = collectModuleBindings(file.ast);
      walk(file.ast.program, (node) => {
        if (node.type === "CallExpression") {
          const target = resolveCallTarget(node, bindings);
          const isFs = target?.module === "fs" || target?.module === "fs/promises";
          const firstArg = node.arguments[0];
          // path.join(os.homedir(), ".ssh", "id_rsa") style: check all string literal args,
          // descending into nested path.join/path.resolve calls.
          const literals: string[] = [];
          for (const arg of node.arguments) {
            collectPathLiterals(arg, literals);
          }
          const combined = literals.join("/");
          const label = classify(combined) ?? literals.map(classify).find(Boolean);
          if (label) {
            let direction: "read" | "write" | "reference" = "reference";
            if (isFs && target && READ_FNS.has(target.member)) direction = "read";
            else if (isFs && target && WRITE_FNS.has(target.member)) direction = "write";
            signals.push({
              identity: `path:${label}:${direction}`,
              detail: `${direction}:${label}`,
              confidence: direction === "reference" ? "low" : "high",
              ...fileLine(file, node),
              snippet: snippetFor(file.source, node)
            });
          } else if (firstArg && firstArg.type === "StringLiteral") {
            // handled above
          }
        }
        if (node.type === "StringLiteral") {
          const label = classify(node.value);
          if (label) {
            signals.push({
              identity: `path:${label}:reference`,
              detail: `reference:${label}`,
              confidence: "low",
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
    return newIdentities(oldSignals, newSignals).map((sig) => {
      const [direction, label] = (sig.detail ?? "reference:unknown").split(":");
      const severity = direction === "reference" ? "medium" : "high";
      return {
        code: "DC006",
        severity,
        confidence: sig.confidence ?? "low",
        title: `New sensitive file ${direction}: ${label}`,
        description:
          direction === "reference"
            ? `This version contains a new literal reference to a sensitive path pattern (${label}). ` +
              "The operation performed on it is not statically confirmed."
            : `This version performs a new ${direction} of a sensitive credential/config path (${label}).`,
        file: sig.file,
        line: sig.line,
        column: sig.column,
        newValue: label,
        snippet: sig.snippet
      } satisfies Evidence;
    });
  }
};
