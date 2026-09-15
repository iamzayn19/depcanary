import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverProject } from "../../src/project/discover.js";
import { findAvailableUpdates } from "../../src/project/updates.js";
import { RegistryClient } from "../../src/registry/client.js";
import { UnsupportedProjectError } from "../../src/errors/errors.js";
import { startFakeRegistry, type FakeRegistry } from "../helpers/fake-registry.js";

describe("discoverProject", () => {
  it("reads direct prod and dev deps from a v3 lockfile", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-proj-"));
    try {
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "app",
          dependencies: { leftpad: "^1.0.0" },
          devDependencies: { vitest: "^2.0.0" }
        })
      );
      await writeFile(
        path.join(dir, "package-lock.json"),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {},
            "node_modules/leftpad": { version: "1.0.0" },
            "node_modules/vitest": { version: "2.0.0", dev: true }
          }
        })
      );
      const project = await discoverProject(dir);
      expect(project.dependencies).toEqual(
        expect.arrayContaining([
          { name: "leftpad", version: "1.0.0", dev: false },
          { name: "vitest", version: "2.0.0", dev: true }
        ])
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws UnsupportedProjectError when no package.json exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-proj-empty-"));
    try {
      await expect(discoverProject(dir)).rejects.toBeInstanceOf(UnsupportedProjectError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws UnsupportedProjectError for yarn.lock projects", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-proj-yarn-"));
    try {
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "app" }));
      await writeFile(path.join(dir, "yarn.lock"), "# yarn lockfile v1\n");
      await expect(discoverProject(dir)).rejects.toThrow(/yarn\.lock/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws UnsupportedProjectError for no lockfile at all", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-proj-nolock-"));
    try {
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "app" }));
      await expect(discoverProject(dir)).rejects.toThrow(/npm install/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws UnsupportedProjectError for lockfileVersion 1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "depcanary-proj-v1-"));
    try {
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "app" }));
      await writeFile(path.join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 1 }));
      await expect(discoverProject(dir)).rejects.toThrow(/lockfileVersion/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("findAvailableUpdates", () => {
  let registry: FakeRegistry;

  beforeAll(async () => {
    registry = await startFakeRegistry([
      {
        name: "leftpad",
        versions: [
          { version: "1.0.0", manifest: { name: "leftpad", version: "1.0.0" } },
          { version: "1.2.0", manifest: { name: "leftpad", version: "1.2.0" } }
        ],
        distTags: { latest: "1.2.0" }
      },
      {
        name: "stable-pkg",
        versions: [{ version: "2.0.0", manifest: { name: "stable-pkg", version: "2.0.0" } }],
        distTags: { latest: "2.0.0" }
      }
    ]);
  }, 20000);

  afterAll(async () => {
    await registry.close();
  });

  it("returns only packages with available updates, sorted by name, skips unresolvable", async () => {
    const client = new RegistryClient({ registry: registry.url });
    const updates = await findAvailableUpdates(
      [
        { name: "leftpad", version: "1.0.0", dev: false },
        { name: "stable-pkg", version: "2.0.0", dev: false },
        { name: "does-not-exist", version: "1.0.0", dev: false }
      ],
      client,
      2
    );
    expect(updates).toEqual([{ name: "leftpad", from: "1.0.0", to: "1.2.0" }]);
  });

  it("returns empty array for no deps", async () => {
    const client = new RegistryClient({ registry: registry.url });
    const updates = await findAvailableUpdates([], client, 4);
    expect(updates).toEqual([]);
  });
});
