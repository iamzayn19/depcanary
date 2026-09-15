import type { Severity } from "../constants.js";
import type { File as BabelFile } from "@babel/types";

export interface FileContext {
  relPath: string;
  source: string;
  ast?: BabelFile;
  parseError?: string;
  line(index: number): number;
}

export interface PackageContext {
  files: FileContext[];
  manifest: Record<string, unknown>;
  packedFiles: { relPath: string; size: number }[];
  totalBytes: number;
  binaries: { relPath: string; size: number; magicType: string }[];
  publisher?: string | undefined;
}

export interface Signal {
  /** Stable identity used to match old vs new signals (behavior, not position). */
  identity: string;
  detail?: string | undefined;
  file?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  snippet?: string | undefined;
  confidence?: "high" | "medium" | "low";
}

export interface Evidence {
  code: string;
  severity: Severity;
  confidence: "high" | "medium" | "low";
  title: string;
  description: string;
  file?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  oldValue?: unknown;
  newValue?: unknown;
  snippet?: string | undefined;
  moreLocations?: number;
}

export interface Detector {
  code: string;
  title: string;
  defaultSeverity: Severity;
  summary: string;
  analyze(ctx: PackageContext): Signal[];
  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[];
}
