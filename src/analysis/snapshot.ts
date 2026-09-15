import type { PackageCoordinate } from "../registry/client.js";
import type { ExtractedArchive } from "../archive/extract.js";
import { parseSourceSafely } from "./ast.js";
import { isAnalyzableSource, isCodeFile, isManifest } from "./files.js";
import { classifyBinary } from "../detectors/executable-artifacts.js";
import { ALL_DETECTORS } from "../detectors/index.js";
import type { FileContext, PackageContext, Signal } from "../detectors/types.js";
import { readFile } from "node:fs/promises";
import { LIMITS } from "../constants.js";

export interface Diagnostic {
  level: "info" | "warn";
  message: string;
  file?: string;
}

export interface BehaviorSnapshot {
  coordinate: PackageCoordinate;
  manifest: Record<string, unknown>;
  packedFiles: { relPath: string; size: number }[];
  totalBytes: number;
  signals: Record<string, Signal[]>;
  diagnostics: Diagnostic[];
  publisher?: string | undefined;
}

export async function buildSnapshot(
  coordinate: PackageCoordinate,
  archive: ExtractedArchive,
  publisher?: string
): Promise<BehaviorSnapshot> {
  const diagnostics: Diagnostic[] = [];
  let manifest: Record<string, unknown> = {};

  const manifestFile = archive.files.find((f) => isManifest(f.relPath));
  if (manifestFile) {
    try {
      const raw = await readFile(manifestFile.absPath, "utf8");
      manifest = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      diagnostics.push({ level: "warn", message: `Failed to parse package.json: ${String(err)}` });
    }
  } else {
    diagnostics.push({ level: "warn", message: "No package.json found in archive" });
  }

  const fileContexts: FileContext[] = [];
  const binaries: { relPath: string; size: number; magicType: string }[] = [];

  for (const file of archive.files) {
    if (isCodeFile(file.relPath)) {
      let header: Buffer | undefined;
      try {
        header = await readFile(file.absPath).then((b) => b.subarray(0, 8));
      } catch {
        header = undefined;
      }
      if (header) {
        const magic = classifyBinary(file.relPath, header);
        if (magic) {
          binaries.push({ relPath: file.relPath, size: file.size, magicType: magic });
          continue;
        }
      }
    } else {
      // Non-code file: still check magic bytes for native/executable artifacts.
      try {
        const header = await readFile(file.absPath).then((b) => b.subarray(0, 8));
        const magic = classifyBinary(file.relPath, header);
        if (magic) {
          binaries.push({ relPath: file.relPath, size: file.size, magicType: magic });
        }
      } catch {
        // ignore unreadable file
      }
    }

    if (!isAnalyzableSource(file)) continue;
    if (isManifest(file.relPath)) continue;

    let source: string;
    try {
      source = await readFile(file.absPath, "utf8");
    } catch (err) {
      diagnostics.push({
        level: "warn",
        message: `Failed to read ${file.relPath}: ${String(err)}`,
        file: file.relPath
      });
      continue;
    }
    if (Buffer.byteLength(source, "utf8") > LIMITS.MAX_PARSE_BYTES) {
      diagnostics.push({
        level: "info",
        message: `Skipped oversized file: ${file.relPath}`,
        file: file.relPath
      });
      continue;
    }

    const lineOffsets = computeLineOffsets(source);
    const ctx: FileContext = {
      relPath: file.relPath,
      source,
      line: (index: number) => lineFor(lineOffsets, index)
    };

    const parsed = parseSourceSafely(source, file.relPath);
    if (parsed.ok) {
      ctx.ast = parsed.ast;
    } else {
      ctx.parseError = parsed.error;
      diagnostics.push({
        level: "info",
        message: `Parse failed for ${file.relPath}: ${parsed.error}`,
        file: file.relPath
      });
    }
    fileContexts.push(ctx);
  }

  const packedFiles = archive.files.map((f) => ({ relPath: f.relPath, size: f.size }));
  const context: PackageContext = {
    files: fileContexts,
    manifest,
    packedFiles,
    totalBytes: archive.totalBytes,
    binaries,
    publisher
  };

  const signals: Record<string, Signal[]> = {};
  for (const detector of ALL_DETECTORS) {
    try {
      signals[detector.code] = detector.analyze(context);
    } catch (err) {
      diagnostics.push({
        level: "warn",
        message: `Detector ${detector.code} failed: ${String(err)}`
      });
      signals[detector.code] = [];
    }
  }

  return {
    coordinate,
    manifest,
    packedFiles,
    totalBytes: archive.totalBytes,
    signals,
    diagnostics,
    publisher
  };
}

function computeLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function lineFor(offsets: number[], index: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
