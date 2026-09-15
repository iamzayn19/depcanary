import type { Detector } from "./types.js";
import { lifecycleScriptsDetector } from "./lifecycle-scripts.js";
import { childProcessDetector } from "./child-process.js";
import { shellExecutionDetector } from "./shell-execution.js";
import { networkDetector } from "./network.js";
import { sensitiveEnvDetector } from "./sensitive-env.js";
import { sensitivePathsDetector } from "./sensitive-paths.js";
import { dynamicCodeDetector } from "./dynamic-code.js";
import { executableArtifactsDetector } from "./executable-artifacts.js";
import { obfuscationDetector } from "./obfuscation.js";
import { dependenciesDetector } from "./dependencies.js";
import { packageSizeDetector } from "./package-size.js";
import { publisherDetector } from "./publisher.js";

export const ALL_DETECTORS: Detector[] = [
  lifecycleScriptsDetector,
  childProcessDetector,
  shellExecutionDetector,
  networkDetector,
  sensitiveEnvDetector,
  sensitivePathsDetector,
  dynamicCodeDetector,
  executableArtifactsDetector,
  obfuscationDetector,
  dependenciesDetector,
  packageSizeDetector,
  publisherDetector
];

export function getDetector(code: string): Detector | undefined {
  return ALL_DETECTORS.find((d) => d.code === code.toUpperCase());
}

export type { Detector, Evidence, PackageContext, Signal, FileContext } from "./types.js";
