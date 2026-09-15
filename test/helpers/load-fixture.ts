import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { FakePackageVersion } from "./fake-registry.js";

/**
 * Loads an on-disk fixture package directory (a package.json plus arbitrary
 * source files) into the shape expected by startFakeRegistry(). Used to wire
 * fixtures/packages/** through the real compare() pipeline.
 */
export async function loadFixtureVersion(
  dir: string,
  version: string
): Promise<FakePackageVersion> {
  const manifestRaw = await readFile(path.join(dir, "package.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
  manifest["version"] = version;

  const files: Record<string, string> = {};
  async function walk(sub: string): Promise<void> {
    const entries = await readdir(path.join(dir, sub), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.name === "package.json" && sub === "") continue;
      if (entry.isDirectory()) {
        await walk(relPath);
      } else {
        files[relPath] = await readFile(path.join(dir, relPath), "utf8");
      }
    }
  }
  await walk("");

  return { version, manifest, files };
}
