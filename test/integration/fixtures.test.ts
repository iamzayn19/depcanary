import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { compare } from "../../src/index.js";
import { startFakeRegistry, type FakeRegistry } from "../helpers/fake-registry.js";
import { loadFixtureVersion } from "../helpers/load-fixture.js";

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/packages"
);

let registry: FakeRegistry | undefined;
let cacheDir: string | undefined;

afterEach(async () => {
  await registry?.close();
  registry = undefined;
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  cacheDir = undefined;
});

async function compareFixture(name: string): Promise<Awaited<ReturnType<typeof compare>>> {
  const dir = path.join(FIXTURES_ROOT, name);
  const before = await loadFixtureVersion(path.join(dir, "before"), "1.0.0-before");
  const after = await loadFixtureVersion(path.join(dir, "after"), "2.0.0-after");
  registry = await startFakeRegistry([{ name, versions: [before, after] }]);
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "depcanary-fixtures-"));
  return compare(`${name}@1.0.0-before`, `${name}@2.0.0-after`, {
    registry: registry.url,
    cacheDir,
    cache: false
  });
}

describe("false-positive regression fixtures (§34) — unchanged capability must not be reported", () => {
  it("regression-execa-like: unchanged child_process usage yields no findings", async () => {
    const result = await compareFixture("regression-execa-like");
    expect(result.findings).toHaveLength(0);
  });

  it("regression-http-client: unchanged fetch() destination yields no findings", async () => {
    const result = await compareFixture("regression-http-client");
    expect(result.findings).toHaveLength(0);
  });

  it("regression-telemetry-sdk: unchanged stable network endpoint yields no findings", async () => {
    const result = await compareFixture("regression-telemetry-sdk");
    expect(result.findings).toHaveLength(0);
  });

  it("regression-minified-bundle: unchanged minified bundle yields no findings", async () => {
    const result = await compareFixture("regression-minified-bundle");
    expect(result.findings).toHaveLength(0);
  });

  it("regression-legit-postinstall: unchanged legitimate postinstall yields no findings", async () => {
    const result = await compareFixture("regression-legit-postinstall");
    expect(result.findings).toHaveLength(0);
  });

  it("regression-native-addon: unchanged native addon yields no findings", async () => {
    const result = await compareFixture("regression-native-addon");
    expect(result.findings).toHaveLength(0);
  });
});

describe("adversarial combination fixtures (§35) — genuinely new risky behavior must be reported", () => {
  it("fixture A: new postinstall running a local script is flagged (DC001)", async () => {
    const result = await compareFixture("adversarial-a-postinstall-local-script");
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("DC001");
  });

  it("fixture B: postinstall + NPM_TOKEN + .npmrc + new network destination is flagged as CRITICAL", async () => {
    const result = await compareFixture("adversarial-b-postinstall-secret-network");
    const codes = result.findings.map((f) => f.code).sort();
    expect(codes).toContain("DC001");
    expect(codes).toContain("DC005");
    expect(codes).toContain("DC006");
    expect(codes).toContain("DC004");
    expect(result.risk).toBe("critical");
  });

  it("fixture C: new child_process.exec call is flagged (DC002/DC003)", async () => {
    const result = await compareFixture("adversarial-c-child-process-exec");
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("DC002");
    expect(codes).toContain("DC003");
  });

  it("fixture E: new base64 blob + eval is flagged (DC007/DC009)", async () => {
    const result = await compareFixture("adversarial-e-base64-eval");
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("DC007");
    expect(codes).toContain("DC009");
  });
});
