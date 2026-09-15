import { createHash } from "node:crypto";
import { IntegrityError } from "../errors/errors.js";

const SUPPORTED_ALGOS = new Set(["sha512", "sha1"]);

/**
 * Parses a Subresource-Integrity style string such as:
 *   "sha512-BASE64=="
 * npm registry metadata emits sha512 (preferred) and, on legacy packages, sha1 via
 * dist.shasum (hex, not SRI). This function only parses the SRI `integrity` form.
 */
export function parseIntegrity(integrity: string): { algorithm: string; digestBase64: string } {
  const match = /^([a-z0-9]+)-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
  if (!match || !match[1] || !match[2]) {
    throw new IntegrityError(`Malformed integrity string: "${integrity}"`);
  }
  const algorithm = match[1];
  if (!SUPPORTED_ALGOS.has(algorithm)) {
    throw new IntegrityError(`Unsupported integrity algorithm: "${algorithm}"`);
  }
  return { algorithm, digestBase64: match[2] };
}

export function verifyIntegrity(buffer: Buffer, integrity: string): void {
  const { algorithm, digestBase64 } = parseIntegrity(integrity);
  const actual = createHash(algorithm).update(buffer).digest("base64");
  if (actual !== digestBase64) {
    throw new IntegrityError("ERROR: downloaded artifact failed registry integrity verification");
  }
}

export function verifyShasum(buffer: Buffer, shasum: string): void {
  const actual = createHash("sha1").update(buffer).digest("hex");
  if (actual.toLowerCase() !== shasum.toLowerCase()) {
    throw new IntegrityError("ERROR: downloaded artifact failed registry integrity verification");
  }
}
