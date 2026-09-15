import { describe, it, expect } from "vitest";
import { parsePackageSpec } from "../../src/registry/spec.js";
import { UsageError } from "../../src/errors/errors.js";

describe("parsePackageSpec", () => {
  it("parses name@version", () => {
    expect(parsePackageSpec("lodash@4.17.20")).toEqual({ name: "lodash", rawVersion: "4.17.20" });
  });

  it("parses scoped packages", () => {
    expect(parsePackageSpec("@scope/pkg@1.2.3")).toEqual({
      name: "@scope/pkg",
      rawVersion: "1.2.3"
    });
  });

  it("parses scoped packages with dist-tag", () => {
    expect(parsePackageSpec("@scope/pkg@next")).toEqual({ name: "@scope/pkg", rawVersion: "next" });
  });

  it("defaults to latest with no version", () => {
    expect(parsePackageSpec("package-name")).toEqual({
      name: "package-name",
      rawVersion: "latest"
    });
  });

  it("defaults scoped package with no version to latest", () => {
    expect(parsePackageSpec("@scope/pkg")).toEqual({ name: "@scope/pkg", rawVersion: "latest" });
  });

  it("rejects empty spec", () => {
    expect(() => parsePackageSpec("")).toThrow(UsageError);
  });

  it("rejects invalid package names", () => {
    expect(() => parsePackageSpec("Not Valid!@1.0.0")).toThrow(UsageError);
  });
});
