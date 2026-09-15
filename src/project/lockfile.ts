import { readFile } from "node:fs/promises";
import path from "node:path";
import { UnsupportedProjectError } from "../errors/errors.js";

export interface ProjectDependency {
  name: string;
  version: string;
  dev: boolean;
}

export interface ProjectInfo {
  root: string;
  manifest: Record<string, unknown>;
  lockfileVersion: number;
  dependencies: ProjectDependency[];
}

/**
 * Read-only discovery of the current npm project. Supports package-lock.json
 * (lockfileVersion 2 and 3, the versions emitted by supported npm releases).
 * pnpm/yarn lockfiles are explicitly unsupported in 0.1.0.
 */
export async function discoverProject(cwd: string): Promise<ProjectInfo> {
  const pkgPath = path.join(cwd, "package.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    throw new UnsupportedProjectError(`No readable package.json found in ${cwd}`);
  }

  const hasYarnLock = await exists(path.join(cwd, "yarn.lock"));
  const hasPnpmLock = await exists(path.join(cwd, "pnpm-lock.yaml"));
  const hasNpmLock = await exists(path.join(cwd, "package-lock.json"));

  if (!hasNpmLock) {
    if (hasYarnLock || hasPnpmLock) {
      throw new UnsupportedProjectError(
        "This project uses yarn.lock or pnpm-lock.yaml. DepCanary 0.1.0 only supports npm's " +
          "package-lock.json for project mode. Use explicit version comparisons instead: " +
          "depcanary <package>@<old> <package>@<new>"
      );
    }
    throw new UnsupportedProjectError("No package-lock.json found. Run npm install first.");
  }

  const lockRaw = JSON.parse(await readFile(path.join(cwd, "package-lock.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const lockfileVersion = Number(lockRaw["lockfileVersion"] ?? 0);
  if (lockfileVersion < 2) {
    throw new UnsupportedProjectError(
      `Unsupported package-lock.json lockfileVersion: ${lockfileVersion}. DepCanary supports v2/v3 lockfiles.`
    );
  }

  const packages =
    (lockRaw["packages"] as Record<string, { version?: string; dev?: boolean }>) ?? {};
  const deps: ProjectDependency[] = [];
  const directProd = Object.keys((manifest["dependencies"] as Record<string, string>) ?? {});
  const directDev = Object.keys((manifest["devDependencies"] as Record<string, string>) ?? {});

  for (const name of directProd) {
    const entry = packages[`node_modules/${name}`];
    if (entry?.version) deps.push({ name, version: entry.version, dev: false });
  }
  for (const name of directDev) {
    const entry = packages[`node_modules/${name}`];
    if (entry?.version) deps.push({ name, version: entry.version, dev: true });
  }

  return { root: cwd, manifest, lockfileVersion, dependencies: deps };
}

async function exists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}
