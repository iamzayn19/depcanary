import { LIMITS, DEFAULT_REGISTRY } from "../constants.js";
import { PackageNotFoundError, RegistryError, VersionNotFoundError } from "../errors/errors.js";
import { verifyIntegrity, verifyShasum } from "./integrity.js";

export interface PackageCoordinate {
  name: string;
  version: string;
}

export interface RegistryDist {
  tarball: string;
  integrity?: string;
  shasum?: string;
}

export interface RegistryVersionMeta {
  name: string;
  version: string;
  dist: RegistryDist;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  _npmUser?: { name?: string; email?: string };
  [key: string]: unknown;
}

export interface RegistryPackument {
  name: string;
  "dist-tags"?: Record<string, string>;
  versions: Record<string, RegistryVersionMeta>;
  time?: Record<string, string>;
  _npmUser?: { name?: string; email?: string };
}

export interface ResolvedPackage {
  coordinate: PackageCoordinate;
  meta: RegistryVersionMeta;
  tarball: Buffer;
  publishedBy?: string;
  publishedAt?: string;
}

export interface RegistryClientOptions {
  registry?: string | undefined;
  timeoutMs?: number | undefined;
  maxRedirects?: number | undefined;
}

/**
 * Resolves the effective registry URL following documented precedence:
 *   1. explicit --registry CLI flag
 *   2. npm_config_registry env var (set by npm when invoking scripts)
 *   3. NPM_CONFIG_REGISTRY env var
 *   4. default public registry
 */
export function resolveRegistryUrl(explicit?: string): string {
  return (
    explicit ??
    process.env["npm_config_registry"] ??
    process.env["NPM_CONFIG_REGISTRY"] ??
    DEFAULT_REGISTRY
  );
}

async function boundedFetch(url: string, opts: RegistryClientOptions): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? LIMITS.NETWORK_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? LIMITS.MAX_REDIRECTS;

  let currentUrl = url;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new RegistryError(`Refusing non-HTTP(S) URL: ${currentUrl}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "application/json, application/octet-stream, */*" }
      });
    } catch (err) {
      throw new RegistryError(`Network request failed for ${currentUrl}: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new RegistryError(`Redirect from ${currentUrl} missing Location header`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new RegistryError(`Too many redirects while fetching ${url}`);
}

export class RegistryClient {
  private readonly registry: string;
  private readonly opts: RegistryClientOptions;

  constructor(opts: RegistryClientOptions = {}) {
    this.registry = resolveRegistryUrl(opts.registry).replace(/\/+$/, "");
    this.opts = opts;
  }

  get registryUrl(): string {
    return this.registry;
  }

  async fetchPackument(name: string): Promise<RegistryPackument> {
    const url = `${this.registry}/${encodeURIComponent(name).replace(/^%40/, "@").replace("%2f", "/")}`;
    const res = await boundedFetch(url, this.opts);
    if (res.status === 404) {
      throw new PackageNotFoundError(`Package not found: ${name}`);
    }
    if (!res.ok) {
      throw new RegistryError(`Registry returned HTTP ${res.status} for ${name}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new RegistryError(`Registry returned invalid JSON for ${name}: ${String(err)}`);
    }
    return json as RegistryPackument;
  }

  resolveVersion(packument: RegistryPackument, rawVersion: string): RegistryVersionMeta {
    const tag = packument["dist-tags"]?.[rawVersion];
    const versionKey = tag ?? rawVersion;
    const meta = packument.versions[versionKey];
    if (!meta) {
      throw new VersionNotFoundError(
        `Version "${rawVersion}" not found for package "${packument.name}"`
      );
    }
    return meta;
  }

  async downloadTarball(dist: RegistryDist): Promise<Buffer> {
    const url = new URL(dist.tarball);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new RegistryError(`Refusing non-HTTP(S) tarball URL: ${dist.tarball}`);
    }
    const res = await boundedFetch(dist.tarball, this.opts);
    if (!res.ok) {
      throw new RegistryError(`Failed to download tarball (HTTP ${res.status}): ${dist.tarball}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (dist.integrity) {
      verifyIntegrity(buffer, dist.integrity);
    } else if (dist.shasum) {
      verifyShasum(buffer, dist.shasum);
    }
    return buffer;
  }

  async resolve(name: string, rawVersion: string): Promise<ResolvedPackage> {
    const packument = await this.fetchPackument(name);
    const meta = this.resolveVersion(packument, rawVersion);
    const tarball = await this.downloadTarball(meta.dist);
    const publishedBy = meta._npmUser?.name;
    const publishedAt = packument.time?.[meta.version];
    return {
      coordinate: { name: meta.name, version: meta.version },
      meta,
      tarball,
      ...(publishedBy ? { publishedBy } : {}),
      ...(publishedAt ? { publishedAt } : {})
    };
  }
}
