import { describe, it, expect } from "vitest";
import {
  DepCanaryError,
  UsageError,
  PackageNotFoundError,
  VersionNotFoundError,
  RegistryError,
  IntegrityError,
  ArchiveSafetyError,
  AnalysisError,
  UnsupportedProjectError
} from "../../src/errors/errors.js";

const CASES: [new (message: string) => DepCanaryError, string][] = [
  [UsageError, "UsageError"],
  [PackageNotFoundError, "PackageNotFoundError"],
  [VersionNotFoundError, "VersionNotFoundError"],
  [RegistryError, "RegistryError"],
  [IntegrityError, "IntegrityError"],
  [ArchiveSafetyError, "ArchiveSafetyError"],
  [AnalysisError, "AnalysisError"],
  [UnsupportedProjectError, "UnsupportedProjectError"]
];

describe("DepCanaryError subclasses", () => {
  for (const [Ctor, kind] of CASES) {
    it(`${kind} carries kind, exit code 2, message, and JSON shape`, () => {
      const err = new Ctor("boom");
      expect(err).toBeInstanceOf(DepCanaryError);
      expect(err).toBeInstanceOf(Error);
      expect(err.kind).toBe(kind);
      expect(err.exitCode).toBe(2);
      expect(err.message).toBe("boom");
      expect(err.name).toBe(kind);
      expect(err.toJSON()).toEqual({ kind, message: "boom" });
    });
  }

  it("base DepCanaryError accepts a custom exit code", () => {
    const err = new DepCanaryError("AnalysisError", "custom", 1);
    expect(err.exitCode).toBe(1);
  });
});
