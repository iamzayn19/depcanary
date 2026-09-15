#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compare } from "../analysis/analyzer.js";
import { toHumanReport } from "./format-human.js";
import { toJsonReport, toJsonError } from "./format-json.js";
import { DepCanaryError, UsageError } from "../errors/errors.js";
import { SEVERITY_ORDER, severityRank, type Severity } from "../constants.js";
import { getDetector } from "../detectors/index.js";
import { RegistryClient, resolveRegistryUrl } from "../registry/client.js";
import { defaultCacheDir } from "../cache/cache.js";
import { discoverProject } from "../project/discover.js";
import { findAvailableUpdates } from "../project/updates.js";
import { access, mkdir, rm } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")
) as {
  version: string;
};

interface GlobalOpts {
  json?: boolean;
  color?: boolean;
  quiet?: boolean;
  failOn?: string;
  registry?: string;
  cacheDir?: string;
  cache?: boolean;
}

function colorEnabled(opts: GlobalOpts): boolean {
  if (process.env["NO_COLOR"]) return false;
  if (opts.color === false) return false;
  return process.stdout.isTTY === true;
}

function validateFailOn(value: string | undefined): Severity | undefined {
  if (!value) return undefined;
  if (!SEVERITY_ORDER.includes(value as Severity)) {
    throw new UsageError(
      `Invalid --fail-on value: "${value}". Must be one of ${SEVERITY_ORDER.join("|")}`
    );
  }
  return value as Severity;
}

function exitCodeForFindings(findings: { severity: Severity }[], failOn?: Severity): number {
  if (!failOn) return 0;
  const threshold = severityRank(failOn);
  const met = findings.some((f) => severityRank(f.severity) >= threshold);
  return met ? 1 : 0;
}

async function runDiff(fromSpec: string, toSpec: string, opts: GlobalOpts): Promise<number> {
  const failOn = validateFailOn(opts.failOn);
  try {
    const result = await compare(fromSpec, toSpec, {
      registry: opts.registry,
      cacheDir: opts.cacheDir ?? defaultCacheDir(),
      cache: opts.cache ?? true
    });
    if (opts.json) {
      process.stdout.write(toJsonReport(result) + "\n");
    } else {
      process.stdout.write(toHumanReport(result, colorEnabled(opts)) + "\n");
    }
    return exitCodeForFindings(result.findings, failOn);
  } catch (err) {
    return handleError(err, opts);
  }
}

function handleError(err: unknown, opts: GlobalOpts): number {
  if (err instanceof DepCanaryError) {
    if (opts.json) {
      process.stdout.write(toJsonError(err.kind, err.message) + "\n");
    } else if (!opts.quiet) {
      process.stderr.write(`${pc.red("ERROR")}: ${err.message}\n`);
    }
    return err.exitCode;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (opts.json) {
    process.stdout.write(toJsonError("AnalysisError", message) + "\n");
  } else if (!opts.quiet) {
    process.stderr.write(`${pc.red("ERROR")}: ${message}\n`);
  }
  if (process.env["DEPCANARY_DEBUG"] && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  return 2;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("depcanary")
    .description("See risky dependency updates before they land.")
    .version(pkgJson.version)
    .option("--json", "Output machine-readable JSON to stdout")
    .option("--no-color", "Disable colored output")
    .option("--quiet", "Suppress non-essential stderr output")
    .option(
      "--fail-on <level>",
      "Exit 1 if a finding meets this severity (info|low|medium|high|critical)"
    )
    .option("--registry <url>", "Registry URL to use")
    .option("--cache-dir <path>", "Cache directory to use")
    .option("--no-cache", "Disable the tarball cache")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  depcanary lodash@4.17.20 lodash@4.17.21\n" +
        "  depcanary diff axios@1.6.0 axios@1.7.0\n" +
        "  depcanary axios\n" +
        "  depcanary --all --fail-on high\n" +
        "  depcanary explain DC001\n"
    );

  program
    .command("diff <from> <to>")
    .description("Compare two published versions of the same package")
    .action(async (from: string, to: string) => {
      const opts = program.opts<GlobalOpts>();
      process.exitCode = await runDiff(from, to, opts);
    });

  program
    .command("doctor")
    .description("Validate DepCanary's own operating environment")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      process.exitCode = await runDoctor(opts);
    });

  program
    .command("explain <code>")
    .description("Explain a detector code")
    .action((code: string) => {
      const opts = program.opts<GlobalOpts>();
      process.exitCode = runExplain(code, opts);
    });

  program
    .command("all")
    .description("Analyze available updates for the current project's direct dependencies")
    .option("--include-dev", "Include devDependencies")
    .option("--summary", "Only print the summary table")
    .action(async (cmdOpts: { includeDev?: boolean; summary?: boolean }) => {
      const opts = program.opts<GlobalOpts>();
      process.exitCode = await runAll(opts, cmdOpts);
    });

  // Shorthand: `depcanary <package>` or `depcanary <pkg@old> <pkg@new>`
  program.arguments("[a] [b]").action(async (a?: string, b?: string) => {
    const opts = program.opts<GlobalOpts>();
    if (!a) {
      program.outputHelp();
      process.exitCode = 2;
      return;
    }
    if (a && b) {
      process.exitCode = await runDiff(a, b, opts);
      return;
    }
    process.exitCode = await runSinglePackage(a, opts);
  });

  return program;
}

async function runSinglePackage(pkgArg: string, opts: GlobalOpts): Promise<number> {
  try {
    if (pkgArg.includes("@") && !pkgArg.startsWith("@")) {
      throw new UsageError(
        `"${pkgArg}" looks like a single version spec. Provide two versions to compare, e.g.\n` +
          `  depcanary ${pkgArg.split("@")[0]}@<old> ${pkgArg.split("@")[0]}@<new>`
      );
    }
    if (pkgArg.startsWith("@") && pkgArg.split("@").length > 2) {
      // scoped package with version, e.g. @scope/pkg@1.2.3 -> treat as usage error too
      throw new UsageError(
        `Provide two versions to compare, e.g.\n  depcanary ${pkgArg}@<old> ${pkgArg}@<new>`
      );
    }
    const project = await discoverProject(process.cwd());
    const dep = project.dependencies.find((d) => d.name === pkgArg);
    if (!dep) {
      const message =
        `${pkgArg} is not a dependency of this project.\n\n` +
        `Use explicit versions:\n  depcanary ${pkgArg}@1.0.0 ${pkgArg}@1.1.0`;
      throw new UsageError(message);
    }
    const client = new RegistryClient({ registry: opts.registry });
    const packument = await client.fetchPackument(pkgArg);
    const latest = packument["dist-tags"]?.["latest"];
    if (!latest) {
      throw new UsageError(`Could not resolve latest version for ${pkgArg}`);
    }
    if (!opts.quiet) {
      process.stderr.write(`Resolved ${pkgArg}: installed ${dep.version} -> latest ${latest}\n`);
    }
    return await runDiff(`${pkgArg}@${dep.version}`, `${pkgArg}@${latest}`, opts);
  } catch (err) {
    return handleError(err, opts);
  }
}

async function runAll(
  opts: GlobalOpts,
  cmdOpts: { includeDev?: boolean; summary?: boolean }
): Promise<number> {
  const failOn = validateFailOn(opts.failOn);
  try {
    const project = await discoverProject(process.cwd());
    const deps = project.dependencies.filter((d) => cmdOpts.includeDev || !d.dev);
    const client = new RegistryClient({ registry: opts.registry });
    const updates = await findAvailableUpdates(deps, client, 4);

    if (updates.length === 0) {
      if (!opts.json) process.stdout.write("No direct dependency updates available.\n");
      else process.stdout.write(JSON.stringify({ schemaVersion: 1, updates: [] }, null, 2) + "\n");
      return 0;
    }

    const results = [];
    let worstMet = false;
    for (const u of updates) {
      try {
        const result = await compare(`${u.name}@${u.from}`, `${u.name}@${u.to}`, {
          registry: opts.registry,
          cacheDir: opts.cacheDir ?? defaultCacheDir(),
          cache: opts.cache ?? true
        });
        results.push(result);
        if (exitCodeForFindings(result.findings, failOn) === 1) worstMet = true;
      } catch {
        // Skip packages that fail individually; do not abort the whole run.
      }
    }

    results.sort((a, b) => b.score - a.score);

    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          {
            schemaVersion: 1,
            updates: results.map((r) => ({
              package: r.package,
              from: r.from.version,
              to: r.to.version,
              score: r.score,
              band: r.risk
            }))
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(`${results.length} direct dependency update(s)\n\n`);
      for (const r of results) {
        process.stdout.write(
          `${r.risk.toUpperCase().padEnd(9)} ${r.package.padEnd(20)} ${r.from.version} -> ${r.to.version}   ${r.score}\n`
        );
      }
      if (!cmdOpts.summary) {
        for (const r of results) {
          process.stdout.write("\n" + toHumanReport(r, colorEnabled(opts)) + "\n");
        }
      }
    }
    return worstMet ? 1 : 0;
  } catch (err) {
    return handleError(err, opts);
  }
}

async function runDoctor(opts: GlobalOpts): Promise<number> {
  const lines: string[] = ["DepCanary doctor", ""];
  let ok = true;

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 22) {
    lines.push(`✓ Node ${process.versions.node} supported`);
  } else {
    lines.push(`✗ Node ${process.versions.node} is not supported (requires >=22)`);
    ok = false;
  }

  const registryUrl = resolveRegistryUrl(opts.registry);
  if (registryUrl.startsWith("https://")) {
    lines.push(`✓ registry uses HTTPS (${registryUrl})`);
  } else {
    lines.push(`⚠ registry does not use HTTPS (${registryUrl})`);
  }

  try {
    const client = new RegistryClient({ registry: opts.registry });
    await client.fetchPackument("npm");
    lines.push("✓ npm registry reachable");
  } catch {
    lines.push("⚠ npm registry unreachable (network-dependent checks skipped)");
  }

  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  try {
    await mkdir(cacheDir, { recursive: true });
    const probe = path.join(cacheDir, `.probe-${process.pid}`);
    await mkdir(probe, { recursive: true });
    await rm(probe, { recursive: true, force: true });
    lines.push(`✓ cache directory writable (${cacheDir})`);
  } catch {
    lines.push(`✗ cache directory not writable (${cacheDir})`);
    ok = false;
  }

  try {
    await access(path.join(process.cwd(), "package-lock.json"));
    lines.push("✓ package-lock.json detected");
  } catch {
    lines.push("⚠ no package-lock.json detected in current directory");
  }

  lines.push("");
  lines.push(ok ? "Ready." : "Issues found.");

  if (opts.json) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok, lines }, null, 2) + "\n");
  } else {
    process.stdout.write(lines.join("\n") + "\n");
  }
  return ok ? 0 : 2;
}

function runExplain(code: string, opts: GlobalOpts): number {
  const detector = getDetector(code);
  if (!detector) {
    if (opts.json) {
      process.stdout.write(toJsonError("UsageError", `Unknown detector: ${code}`) + "\n");
    } else {
      process.stderr.write(`Unknown detector: ${code}\n`);
    }
    return 2;
  }
  const text =
    `${detector.code} — ${detector.title}\n\n` +
    `Default severity: ${detector.defaultSeverity}\n\n` +
    `${detector.summary}\n\n` +
    `DepCanary reports this detector only when the behavior is newly introduced between the two ` +
    `compared versions; unchanged capability is not reported. This is a review signal, not proof of ` +
    `malicious intent.\n`;
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          schemaVersion: 1,
          code: detector.code,
          title: detector.title,
          severity: detector.defaultSeverity,
          summary: detector.summary
        },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stdout.write(text);
  }
  return 0;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  process.stderr.write(`Unexpected error: ${String(err)}\n`);
  process.exitCode = 2;
});
