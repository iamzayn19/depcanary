import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSnapshot } from "../../src/analysis/snapshot.js";
import type { ExtractedArchive, ExtractedFile } from "../../src/archive/extract.js";

let root: string | undefined;

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

async function makeArchive(files: Record<string, string | Buffer>): Promise<ExtractedArchive> {
  root = await mkdtemp(path.join(tmpdir(), "depcanary-snapshot-test-"));
  const entries: ExtractedFile[] = [];
  let totalBytes = 0;
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(root, relPath);
    await writeFile(absPath, content);
    const size = Buffer.byteLength(content);
    totalBytes += size;
    entries.push({ relPath, absPath, size, mode: 0o644 });
  }
  return {
    root,
    files: entries,
    totalBytes,
    cleanup: async () => {
      /* handled by afterEach */
    }
  };
}

describe("buildSnapshot", () => {
  it("records a diagnostic when package.json is missing", async () => {
    const archive = await makeArchive({ "index.js": "module.exports = 1;" });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    expect(snapshot.diagnostics.some((d) => d.message.includes("No package.json"))).toBe(true);
  });

  it("records a diagnostic when package.json is malformed", async () => {
    const archive = await makeArchive({ "package.json": "{not valid json" });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    expect(
      snapshot.diagnostics.some((d) => d.message.includes("Failed to parse package.json"))
    ).toBe(true);
  });

  it("parses a valid manifest and returns it", async () => {
    const archive = await makeArchive({
      "package.json": JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        scripts: { postinstall: "x" }
      })
    });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    expect(snapshot.manifest["name"]).toBe("pkg");
  });

  it("records a diagnostic (parse failure, info level) for unparsable source", async () => {
    const archive = await makeArchive({
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "broken.js": "function( ( ( invalid syntax {{{"
    });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    expect(snapshot.diagnostics.some((d) => d.message.includes("Parse failed"))).toBe(true);
  });

  it("detects a binary artifact via magic bytes in a code-extension file", async () => {
    const archive = await makeArchive({
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "weird.js": Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 1, 2, 3])
    });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    expect(snapshot.signals["DC008"]?.some((s) => s.file === "weird.js")).toBe(true);
  });

  it("detects a binary artifact via magic bytes in a non-code-extension file", async () => {
    const archive = await makeArchive({
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "addon.node": Buffer.from([1, 2, 3, 4])
    });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    expect(snapshot.signals["DC008"]?.some((s) => s.file === "addon.node")).toBe(true);
  });

  it("skips non-analyzable, non-binary files without error (e.g. markdown, lockfiles)", async () => {
    const archive = await makeArchive({
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "README.md": "# hello",
      "package-lock.json": "{}"
    });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    expect(snapshot.packedFiles.length).toBe(3);
  });

  it("passes through publisher metadata when provided", async () => {
    const archive = await makeArchive({
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" })
    });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive, "alice");
    expect(snapshot.publisher).toBe("alice");
  });

  it("computes line numbers correctly for multi-line source", async () => {
    const archive = await makeArchive({
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "multi.js": "const a = 1;\nconst b = 2;\nrequire('child_process').exec('x');\n"
    });
    const snapshot = await buildSnapshot({ name: "pkg", version: "1.0.0" }, archive);
    const dc002 = snapshot.signals["DC002"];
    expect(dc002?.[0]?.line).toBe(3);
  });
});
