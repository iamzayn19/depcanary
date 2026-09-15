import type { Detector, Evidence, PackageContext, Signal } from "./types.js";

export interface BinaryFileInfo {
  relPath: string;
  size: number;
  magicType: string;
}

/** Magic-byte sniffing helper, exported for use by the analyzer while building PackageContext. */
export function classifyBinary(relPath: string, header: Buffer): string | undefined {
  if (relPath.endsWith(".node")) return "native-addon";
  if (
    relPath.endsWith(".wasm") &&
    header.length >= 4 &&
    header[0] === 0x00 &&
    header[1] === 0x61 &&
    header[2] === 0x73 &&
    header[3] === 0x6d
  ) {
    return "wasm";
  }
  if (
    header.length >= 4 &&
    header[0] === 0x7f &&
    header[1] === 0x45 &&
    header[2] === 0x4c &&
    header[3] === 0x46
  ) {
    return "elf";
  }
  if (
    header.length >= 4 &&
    ((header[0] === 0xfe && header[1] === 0xed && header[2] === 0xfa) ||
      (header[0] === 0xcf && header[1] === 0xfa && header[2] === 0xed))
  ) {
    return "mach-o";
  }
  if (header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a) {
    return "pe";
  }
  return undefined;
}

export const executableArtifactsDetector: Detector = {
  code: "DC008",
  title: "New executable/native artifact",
  defaultSeverity: "high",
  summary:
    "Flags newly packed native/executable binaries (.node, .wasm, ELF, Mach-O, PE) detected via magic bytes.",

  analyze(ctx: PackageContext): Signal[] {
    const binaries = ctx.binaries ?? [];
    return binaries.map((b) => ({
      identity: `bin:${b.relPath}`,
      detail: `${b.magicType}:${b.size}`,
      confidence: "high" as const,
      file: b.relPath
    }));
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    const oldSet = new Set(oldSignals.map((s) => s.identity));
    return newSignals
      .filter((s) => !oldSet.has(s.identity))
      .map((sig) => {
        const [type, size] = (sig.detail ?? "unknown:0").split(":");
        return {
          code: "DC008",
          severity: "high",
          confidence: "high",
          title: `New executable artifact: ${sig.file}`,
          description:
            `This version packs a new ${type} binary (${size} bytes) at "${sig.file}". ` +
            "DepCanary does not execute this file; review its provenance manually.",
          file: sig.file,
          newValue: `${type}, ${size} bytes`
        } satisfies Evidence;
      });
  }
};
