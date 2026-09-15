import { parseSourceSafely } from "../../src/analysis/ast.js";
import type { FileContext, PackageContext } from "../../src/detectors/types.js";

export function makeFile(relPath: string, source: string): FileContext {
  const parsed = parseSourceSafely(source, relPath);
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  const line = (index: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid]! <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  return {
    relPath,
    source,
    ...(parsed.ok ? { ast: parsed.ast } : { parseError: parsed.error }),
    line
  };
}

export interface ContextOptions {
  manifest?: Record<string, unknown>;
  files?: Record<string, string>;
  packedFiles?: { relPath: string; size: number }[];
  totalBytes?: number;
  binaries?: { relPath: string; size: number; magicType: string }[];
  publisher?: string;
}

export function makeContext(opts: ContextOptions = {}): PackageContext {
  const files = Object.entries(opts.files ?? {}).map(([p, src]) => makeFile(p, src));
  const packedFiles =
    opts.packedFiles ??
    files
      .map((f) => ({ relPath: f.relPath, size: f.source.length }))
      .concat([{ relPath: "package.json", size: JSON.stringify(opts.manifest ?? {}).length }]);
  return {
    files,
    manifest: opts.manifest ?? {},
    packedFiles,
    totalBytes: opts.totalBytes ?? packedFiles.reduce((a, f) => a + f.size, 0),
    binaries: opts.binaries ?? [],
    publisher: opts.publisher
  };
}
