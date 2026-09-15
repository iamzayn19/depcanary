import { LIMITS } from "../constants.js";
import type { ExtractedFile } from "../archive/extract.js";

const CODE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".cts", ".mts", ".tsx"]);

const SKIP_EXTENSIONS = new Set([
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".ico",
  ".md",
  ".markdown",
  ".txt",
  ".lock"
]);

export function isCodeFile(relPath: string): boolean {
  const ext = extname(relPath);
  return CODE_EXTENSIONS.has(ext);
}

export function isManifest(relPath: string): boolean {
  return relPath === "package.json";
}

export function isAnalyzableSource(file: ExtractedFile): boolean {
  const ext = extname(file.relPath);
  if (SKIP_EXTENSIONS.has(ext)) return false;
  if (!isCodeFile(file.relPath) && !isManifest(file.relPath)) return false;
  if (file.size > LIMITS.MAX_PARSE_BYTES) return false;
  return true;
}

function extname(p: string): string {
  const idx = p.lastIndexOf(".");
  if (idx <= 0) return "";
  return p.slice(idx).toLowerCase();
}
