import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { verifyIntegrity, verifyShasum, parseIntegrity } from "../../src/registry/integrity.js";
import { IntegrityError } from "../../src/errors/errors.js";

describe("integrity", () => {
  it("verifies a matching sha512 integrity string", () => {
    const buf = Buffer.from("hello world");
    const digest = createHash("sha512").update(buf).digest("base64");
    expect(() => verifyIntegrity(buf, `sha512-${digest}`)).not.toThrow();
  });

  it("throws on corrupted tarball", () => {
    const buf = Buffer.from("hello world");
    const digest = createHash("sha512").update(buf).digest("base64");
    const corrupted = Buffer.concat([buf, Buffer.from("x")]);
    expect(() => verifyIntegrity(corrupted, `sha512-${digest}`)).toThrow(IntegrityError);
  });

  it("throws on malformed integrity string", () => {
    expect(() => parseIntegrity("not-a-valid-integrity!!!")).toThrow(IntegrityError);
    expect(() => parseIntegrity("garbage")).toThrow(IntegrityError);
  });

  it("rejects unsupported algorithms", () => {
    expect(() => parseIntegrity("md5-abcd")).toThrow(IntegrityError);
  });

  it("verifies legacy shasum", () => {
    const buf = Buffer.from("hello world");
    const sha1 = createHash("sha1").update(buf).digest("hex");
    expect(() => verifyShasum(buf, sha1)).not.toThrow();
    expect(() => verifyShasum(buf, "0".repeat(40))).toThrow(IntegrityError);
  });
});
