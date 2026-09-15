import { defaultCacheDir } from "./cache/cache.js";

export interface DepCanaryConfig {
  registry?: string | undefined;
  cacheDir: string;
  cache: boolean;
}

export function resolveConfig(overrides: Partial<DepCanaryConfig> = {}): DepCanaryConfig {
  return {
    registry: overrides.registry,
    cacheDir: overrides.cacheDir ?? defaultCacheDir(),
    cache: overrides.cache ?? true
  };
}
