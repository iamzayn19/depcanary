import { describe, it, expect } from "vitest";
import { sanitizeEntryPath, isSafeLinkTarget } from "../../src/archive/safety.js";
import { ArchiveSafetyError } from "../../src/errors/errors.js";

describe("sanitizeEntryPath", () => {
  it("strips the conventional package/ prefix", () => {
    expect(sanitizeEntryPath("package/index.js")).toBe("index.js");
    expect(sanitizeEntryPath("package/lib/a.js")).toBe("lib/a.js");
  });

  it("rejects empty paths", () => {
    expect(() => sanitizeEntryPath("")).toThrow(ArchiveSafetyError);
  });

  it("rejects absolute POSIX paths", () => {
    expect(() => sanitizeEntryPath("/etc/passwd")).toThrow(ArchiveSafetyError);
  });

  it("rejects Windows drive paths", () => {
    expect(() => sanitizeEntryPath("C:\\Windows\\System32\\evil.dll")).toThrow(ArchiveSafetyError);
    expect(() => sanitizeEntryPath("C:/Windows/evil.dll")).toThrow(ArchiveSafetyError);
  });

  it("rejects UNC paths", () => {
    expect(() => sanitizeEntryPath("\\\\server\\share\\evil")).toThrow(ArchiveSafetyError);
  });

  it("rejects simple ../ traversal", () => {
    expect(() => sanitizeEntryPath("package/../../../etc/passwd")).toThrow(ArchiveSafetyError);
    expect(() => sanitizeEntryPath("../outside.txt")).toThrow(ArchiveSafetyError);
  });

  it("rejects traversal that dips negative mid-path even if it nets non-negative", () => {
    expect(() => sanitizeEntryPath("package/../../etc/passwd")).toThrow(ArchiveSafetyError);
  });

  it("allows internal .. that stays within bounds after a deeper directory", () => {
    expect(sanitizeEntryPath("package/lib/nested/../sibling.js")).toBe("lib/nested/../sibling.js");
  });

  it("treats the bare top-level package entry as the extraction root, not an error", () => {
    expect(sanitizeEntryPath("package/")).toBe(".");
    expect(sanitizeEntryPath("package")).toBe(".");
  });

  it("normalizes backslashes for segment checks", () => {
    expect(() => sanitizeEntryPath("package\\..\\..\\evil")).toThrow(ArchiveSafetyError);
  });
});

describe("isSafeLinkTarget", () => {
  it("rejects empty targets", () => {
    expect(isSafeLinkTarget("")).toBe(false);
  });

  it("rejects absolute targets", () => {
    expect(isSafeLinkTarget("/etc/passwd")).toBe(false);
  });

  it("rejects drive-letter targets", () => {
    expect(isSafeLinkTarget("C:\\evil")).toBe(false);
  });

  it("rejects traversal escaping the root", () => {
    expect(isSafeLinkTarget("../../etc/passwd")).toBe(false);
    expect(isSafeLinkTarget("a/../../b")).toBe(false);
  });

  it("allows a same-directory relative symlink target", () => {
    expect(isSafeLinkTarget("lib/index.js")).toBe(true);
    expect(isSafeLinkTarget("a/../b")).toBe(true);
  });
});

describe("adversarial path fuzz", () => {
  const maliciousInputs = [
    "../etc/passwd",
    "../../../../etc/shadow",
    "package/../../../../root/.ssh/authorized_keys",
    "/root/.bashrc",
    "C:\\Users\\victim\\.ssh\\id_rsa",
    "\\\\evil\\share\\payload.exe",
    "package/a/b/../../../../../etc/hosts"
  ];
  for (const input of maliciousInputs) {
    it(`rejects: ${input}`, () => {
      expect(() => sanitizeEntryPath(input)).toThrow(ArchiveSafetyError);
    });
  }

  const benignInputs = [
    "package/index.js",
    "package/lib/deep/nested/file.js",
    "package/a/./b.js",
    "package/dir/../file.js"
  ];
  for (const input of benignInputs) {
    it(`accepts: ${input}`, () => {
      expect(() => sanitizeEntryPath(input)).not.toThrow();
    });
  }
});
