import { RegistryClient, type PackageCoordinate } from "../registry/client.js";
import { extractTarballSafely } from "../archive/extract.js";
import { buildSnapshot, type BehaviorSnapshot, type Diagnostic } from "./snapshot.js";
import { diffSnapshots } from "./delta.js";
import { computeScore } from "../scoring/score.js";
import { TarballCache, defaultCacheDir } from "../cache/cache.js";
import type { Evidence } from "../detectors/types.js";
import type { RiskBand } from "../scoring/severity.js";
import { UsageError } from "../errors/errors.js";
import { parsePackageSpec } from "../registry/spec.js";

export interface CompareOptions {
  registry?: string | undefined;
  cacheDir?: string | undefined;
  cache?: boolean | undefined;
}

export interface ComparisonSummary {
  files: { from: number; to: number };
  packedSize: { from: number; to: number };
  dependencies: { added: number; removed: number };
}

export interface ComparisonResult {
  package: string;
  from: PackageCoordinate;
  to: PackageCoordinate;
  score: number;
  risk: RiskBand;
  findings: Evidence[];
  summary: ComparisonSummary;
  diagnostics: Diagnostic[];
}

async function resolveAndSnapshot(
  name: string,
  rawVersion: string,
  client: RegistryClient,
  cache: TarballCache
): Promise<BehaviorSnapshot> {
  const packument = await client.fetchPackument(name);
  const meta = client.resolveVersion(packument, rawVersion);
  const dist = meta.dist;

  let tarball = await cache.get(name, meta.version, dist.integrity);
  if (!tarball) {
    tarball = await client.downloadTarball(dist);
    await cache.set(name, meta.version, tarball, dist.integrity);
  }

  const archive = await extractTarballSafely(tarball);
  try {
    const publisher = meta._npmUser?.name;
    return await buildSnapshot({ name: meta.name, version: meta.version }, archive, publisher);
  } finally {
    await archive.cleanup();
  }
}

function depCount(manifest: Record<string, unknown>): number {
  const deps = (manifest["dependencies"] as Record<string, string> | undefined) ?? {};
  return Object.keys(deps).length;
}

export async function compare(
  from: string,
  to: string,
  options: CompareOptions = {}
): Promise<ComparisonResult> {
  const fromSpec = parsePackageSpec(from);
  const toSpec = parsePackageSpec(to);
  if (fromSpec.name !== toSpec.name) {
    throw new UsageError(
      `depcanary diff requires the same package name on both sides (got "${fromSpec.name}" and "${toSpec.name}").`
    );
  }

  const client = new RegistryClient({ registry: options.registry });
  const cache = new TarballCache(options.cacheDir ?? defaultCacheDir(), options.cache ?? true);

  const [oldSnap, newSnap] = await Promise.all([
    resolveAndSnapshot(fromSpec.name, fromSpec.rawVersion, client, cache),
    resolveAndSnapshot(toSpec.name, toSpec.rawVersion, client, cache)
  ]);

  const findings = diffSnapshots(oldSnap, newSnap);
  const { score, band } = computeScore(findings);

  const oldDeps = depCount(oldSnap.manifest);
  const newDeps = depCount(newSnap.manifest);
  const oldDepNames = new Set(
    Object.keys((oldSnap.manifest["dependencies"] as Record<string, string>) ?? {})
  );
  const newDepNames = new Set(
    Object.keys((newSnap.manifest["dependencies"] as Record<string, string>) ?? {})
  );
  let added = 0;
  let removed = 0;
  for (const d of newDepNames) if (!oldDepNames.has(d)) added++;
  for (const d of oldDepNames) if (!newDepNames.has(d)) removed++;
  void oldDeps;
  void newDeps;

  return {
    package: fromSpec.name,
    from: oldSnap.coordinate,
    to: newSnap.coordinate,
    score,
    risk: band,
    findings,
    summary: {
      files: { from: oldSnap.packedFiles.length, to: newSnap.packedFiles.length },
      packedSize: { from: oldSnap.totalBytes, to: newSnap.totalBytes },
      dependencies: { added, removed }
    },
    diagnostics: [...oldSnap.diagnostics, ...newSnap.diagnostics]
  };
}
