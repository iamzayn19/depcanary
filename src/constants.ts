/** Central, documented resource limits and tunables. See docs/security-model.md. */
export const LIMITS = {
  /** Maximum number of entries allowed inside an extracted tarball. */
  MAX_ARCHIVE_FILES: 20000,
  /** Maximum total bytes written to disk while extracting a single tarball. */
  MAX_EXTRACTED_BYTES: 200 * 1024 * 1024,
  /** Maximum bytes of a single packed entry allowed during extraction. */
  MAX_ENTRY_BYTES: 50 * 1024 * 1024,
  /** Maximum bytes of a single source file that will be handed to the AST parser. */
  MAX_PARSE_BYTES: 2 * 1024 * 1024,
  /** Maximum bytes of an evidence snippet included in output. */
  MAX_SNIPPET_BYTES: 240,
  /** Maximum number of redirects followed while fetching registry/tarball data. */
  MAX_REDIRECTS: 5,
  /** Network timeout (ms) for a single HTTP request. */
  NETWORK_TIMEOUT_MS: 15000,
  /** Maximum number of concurrent tarball/metadata downloads. */
  MAX_CONCURRENT_DOWNLOADS: 4,
  /** Maximum number of duplicate evidence locations shown per unique finding. */
  MAX_EVIDENCE_LOCATIONS: 3
} as const;

export const SCHEMA_VERSION = 1;

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}
