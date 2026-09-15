import type { Detector, Evidence, PackageContext, Signal } from "./types.js";
import { walk } from "../analysis/ast.js";
import { fileLine, newIdentities, snippetFor } from "./util.js";

const BENIGN = new Set([
  "NODE_ENV",
  "CI",
  "DEBUG",
  "HOME",
  "PATH",
  "TERM",
  "LANG",
  "PWD",
  "SHELL",
  "USER"
]);

const HIGH_VALUE = new Set([
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CI_JOB_TOKEN",
  "SSH_AUTH_SOCK"
]);

const SECRET_PATTERN = /(_TOKEN|_SECRET|_PASSWORD|_API_KEY|^AZURE_)$/i;

function classify(name: string): "high" | "medium" | undefined {
  if (BENIGN.has(name)) return undefined;
  if (HIGH_VALUE.has(name)) return "high";
  if (SECRET_PATTERN.test(name)) return "medium";
  return undefined;
}

export const sensitiveEnvDetector: Detector = {
  code: "DC005",
  title: "New sensitive environment-variable access",
  defaultSeverity: "high",
  summary:
    "Flags newly introduced reads of credential-like environment variables (exact known names and " +
    "*_TOKEN/*_SECRET/*_PASSWORD/*_API_KEY patterns), excluding common benign variables.",

  analyze(ctx: PackageContext): Signal[] {
    const signals: Signal[] = [];
    for (const file of ctx.files) {
      if (!file.ast) continue;
      walk(file.ast.program, (node) => {
        if (
          node.type === "MemberExpression" &&
          !node.computed &&
          node.property.type === "Identifier" &&
          node.object.type === "MemberExpression" &&
          !node.object.computed &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "env" &&
          node.object.object.type === "Identifier" &&
          node.object.object.name === "process"
        ) {
          const name = node.property.name;
          const severity = classify(name);
          if (!severity) return;
          signals.push({
            identity: `env:${name}`,
            detail: name,
            confidence: "high",
            ...fileLine(file, node),
            snippet: snippetFor(file.source, node)
          });
        }
        // process.env["NAME"]
        if (
          node.type === "MemberExpression" &&
          node.computed &&
          node.property.type === "StringLiteral" &&
          node.object.type === "MemberExpression" &&
          !node.object.computed &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "env" &&
          node.object.object.type === "Identifier" &&
          node.object.object.name === "process"
        ) {
          const name = node.property.value;
          const severity = classify(name);
          if (!severity) return;
          signals.push({
            identity: `env:${name}`,
            detail: name,
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
    return newIdentities(oldSignals, newSignals).map((sig) => {
      const severity = HIGH_VALUE.has(sig.detail ?? "") ? "high" : "medium";
      return {
        code: "DC005",
        severity,
        confidence: "high",
        title: `New sensitive environment access: ${sig.detail}`,
        description:
          `This version reads the environment variable "${sig.detail}" for the first time. ` +
          "This variable commonly holds credentials/secrets and its access should be reviewed.",
        file: sig.file,
        line: sig.line,
        column: sig.column,
        newValue: sig.detail,
        snippet: sig.snippet
      } satisfies Evidence;
    });
  }
};
