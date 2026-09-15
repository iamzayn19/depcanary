import { RegistryClient } from "../registry/client.js";
import type { ProjectDependency } from "./lockfile.js";

export interface AvailableUpdate {
  name: string;
  from: string;
  to: string;
}

/**
 * Resolves the latest registry version for each direct dependency and returns
 * only those where an update is available. Bounded concurrency, deterministic
 * ordering by package name. Never mutates the project.
 */
export async function findAvailableUpdates(
  deps: ProjectDependency[],
  client: RegistryClient,
  concurrency = 4
): Promise<AvailableUpdate[]> {
  const results: (AvailableUpdate | undefined)[] = new Array(deps.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = index++;
      if (i >= deps.length) return;
      const dep = deps[i]!;
      try {
        const packument = await client.fetchPackument(dep.name);
        const latestTag = packument["dist-tags"]?.["latest"];
        if (latestTag && latestTag !== dep.version) {
          results[i] = { name: dep.name, from: dep.version, to: latestTag };
        }
      } catch {
        // Skip packages that fail to resolve; do not abort the whole batch.
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, deps.length) }, () => worker());
  await Promise.all(workers);

  return results
    .filter((r): r is AvailableUpdate => r !== undefined)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}
