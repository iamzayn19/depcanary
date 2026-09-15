import { ArchiveSafetyError } from "../errors/errors.js";

/**
 * Validates a single tar entry path for traversal/absolute/drive-letter attacks.
 * Throws ArchiveSafetyError if the path is unsafe. Returns the normalized,
 * package-relative path (with the conventional npm "package/" prefix stripped)
 * on success.
 */
export function sanitizeEntryPath(rawPath: string): string {
  if (!rawPath || rawPath.length === 0) {
    throw new ArchiveSafetyError("Archive entry has an empty path");
  }
  // Reject absolute POSIX paths.
  if (rawPath.startsWith("/")) {
    throw new ArchiveSafetyError(`Archive entry uses an absolute path: ${rawPath}`);
  }
  // Reject Windows drive-letter and UNC paths.
  if (/^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.startsWith("\\\\")) {
    throw new ArchiveSafetyError(`Archive entry uses a Windows drive/UNC path: ${rawPath}`);
  }
  // Normalize backslashes to forward slashes for consistent segment checks.
  const normalized = rawPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  let depth = 0;
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) {
        throw new ArchiveSafetyError(`Archive entry escapes extraction root: ${rawPath}`);
      }
      continue;
    }
    depth += 1;
  }
  // Strip the conventional single top-level "package/" directory npm tarballs use.
  // The bare "package" / "package/" entry itself (the top-level directory entry that
  // every real npm tarball contains) legitimately resolves to the extraction root -
  // represent that as "." rather than treating it as an error.
  const withoutPrefix = normalized.replace(/^package\/?$/, ".").replace(/^package\//, "");
  if (withoutPrefix.length === 0) {
    return ".";
  }
  return withoutPrefix;
}

export function isSafeLinkTarget(linkTarget: string): boolean {
  if (!linkTarget) return false;
  if (linkTarget.startsWith("/")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(linkTarget)) return false;
  const normalized = linkTarget.replace(/\\/g, "/");
  let depth = 0;
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) return false;
      continue;
    }
    depth += 1;
  }
  return true;
}
