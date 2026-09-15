import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig } from "../../src/config.js";
import { TarballCache, defaultCacheDir } from "../../src/cache/cache.js";
import { sanitizeForTerminal, truncateList } from "../../src/analysis/evidence.js";

describe("resolveConfig", () => {
  it("applies defaults when nothing is overridden", () => {
    const cfg = resolveConfig();
    expect(cfg.cache).toBe(true);
    expect(cfg.registry).toBeUndefined();
    expect(cfg.cacheDir).toBe(defaultCacheDir());
  });

  it("respects overrides", () => {
    const cfg = resolveConfig({
      registry: "https://example.invalid",
      cacheDir: "/tmp/x",
      cache: false
    });
    expect(cfg.registry).toBe("https://example.invalid");
    expect(cfg.cacheDir).toBe("/tmp/x");
    expect(cfg.cache).toBe(false);
  });
});

describe("TarballCache", () => {
  it("returns undefined on miss and round-trips a set/get", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-cache-"));
    try {
      const cache = new TarballCache(dir, true);
      expect(await cache.get("widget", "1.0.0")).toBeUndefined();
      const buf = Buffer.from("hello");
      await cache.set("widget", "1.0.0", buf, "sha512-abc");
      const got = await cache.get("widget", "1.0.0", "sha512-abc");
      expect(got).toEqual(buf);
      // different integrity -> different cache key -> miss
      expect(await cache.get("widget", "1.0.0", "sha512-different")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op when disabled", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-cache-disabled-"));
    try {
      const cache = new TarballCache(dir, false);
      await cache.set("widget", "1.0.0", Buffer.from("x"));
      expect(await cache.get("widget", "1.0.0")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("degrades gracefully when the cache directory cannot be written", async () => {
    // Point at a path that cannot be created (parent is a file, not a dir).
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-cache-blocked-"));
    try {
      const blockerFile = path.join(dir, "blocker");
      await import("node:fs/promises").then((fs) => fs.writeFile(blockerFile, "x"));
      const cache = new TarballCache(path.join(blockerFile, "nested"), true);
      await expect(cache.set("widget", "1.0.0", Buffer.from("x"))).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sanitizes package names with unsafe characters in the cache key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-cache-scoped-"));
    try {
      const cache = new TarballCache(dir, true);
      await cache.set("@scope/pkg", "1.0.0", Buffer.from("y"));
      const got = await cache.get("@scope/pkg", "1.0.0");
      expect(got).toEqual(Buffer.from("y"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sanitizeForTerminal", () => {
  it("returns empty string for non-string input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(sanitizeForTerminal(42 as any)).toBe("");
  });

  it("normalizes newlines, tabs and carriage returns to spaces", () => {
    expect(sanitizeForTerminal("a\nb\r\nc\td")).toBe("a b c d");
  });

  it("strips control characters including ESC sequences", () => {
    const out = sanitizeForTerminal("safe\x1b[31mred\x1b[0m\x07end");

    expect(out).not.toMatch(/\x1b|\x07/);
  });

  it("truncates and appends an ellipsis when over the max length", () => {
    const out = sanitizeForTerminal("a".repeat(50), 10);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(13);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves short benign strings untouched", () => {
    expect(sanitizeForTerminal("https://example.invalid/path")).toBe(
      "https://example.invalid/path"
    );
  });
});

describe("truncateList", () => {
  it("returns all items with zero more when under the max", () => {
    const { shown, more } = truncateList([1, 2, 3], 5);
    expect(shown).toEqual([1, 2, 3]);
    expect(more).toBe(0);
  });

  it("truncates and reports the remainder", () => {
    const { shown, more } = truncateList([1, 2, 3, 4, 5], 2);
    expect(shown).toEqual([1, 2]);
    expect(more).toBe(3);
  });

  it("uses the default max from LIMITS when not provided", () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const { shown, more } = truncateList(items);
    expect(shown.length + more).toBe(1000);
  });
});
