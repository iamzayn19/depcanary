import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

export function defaultCacheDir(): string {
  return path.join(os.homedir(), ".cache", "depcanary");
}

export class TarballCache {
  constructor(
    private readonly dir: string,
    private readonly enabled: boolean = true
  ) {}

  private keyFor(name: string, version: string, integrity?: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const hash = createHash("sha256")
      .update(integrity ?? "")
      .digest("hex")
      .slice(0, 16);
    return `${safeName}-${version}-${hash}.tgz`;
  }

  async get(name: string, version: string, integrity?: string): Promise<Buffer | undefined> {
    if (!this.enabled) return undefined;
    const file = path.join(this.dir, this.keyFor(name, version, integrity));
    try {
      await stat(file);
      return await readFile(file);
    } catch {
      return undefined;
    }
  }

  async set(name: string, version: string, buffer: Buffer, integrity?: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const file = path.join(this.dir, this.keyFor(name, version, integrity));
      await writeFile(file, buffer, { mode: 0o600 });
    } catch {
      // Cache failures degrade gracefully; never fail the comparison.
    }
  }
}
