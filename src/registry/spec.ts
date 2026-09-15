import { UsageError } from "../errors/errors.js";

export interface PackageCoordinateSpec {
  name: string;
  /** Version, dist-tag, or range as written by the user (unresolved). */
  rawVersion: string;
}

/**
 * Parses an npm package spec of the form:
 *   lodash@4.17.21
 *   @scope/pkg@1.2.3
 *   @scope/pkg@next
 *   package-name          (no version -> rawVersion === "latest")
 */
export function parsePackageSpec(spec: string): PackageCoordinateSpec {
  if (typeof spec !== "string" || spec.trim().length === 0) {
    throw new UsageError("Package spec must be a non-empty string.");
  }
  const trimmed = spec.trim();
  const scoped = trimmed.startsWith("@");
  const body = scoped ? trimmed.slice(1) : trimmed;
  const atIndex = body.lastIndexOf("@");

  let name: string;
  let rawVersion: string;
  if (atIndex <= 0) {
    name = trimmed;
    rawVersion = "latest";
  } else {
    name = (scoped ? "@" : "") + body.slice(0, atIndex);
    rawVersion = body.slice(atIndex + 1);
  }

  if (rawVersion.length === 0) {
    rawVersion = "latest";
  }

  validatePackageName(name);
  return { name, rawVersion };
}

const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function validatePackageName(name: string): void {
  if (!NAME_RE.test(name) || name.length > 214) {
    throw new UsageError(`Invalid npm package name: "${name}"`);
  }
}
