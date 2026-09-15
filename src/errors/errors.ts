export type ErrorKind =
  | "UsageError"
  | "PackageNotFoundError"
  | "VersionNotFoundError"
  | "RegistryError"
  | "IntegrityError"
  | "ArchiveSafetyError"
  | "AnalysisError"
  | "UnsupportedProjectError";

export class DepCanaryError extends Error {
  readonly kind: ErrorKind;
  /** Exit code the CLI should use when this error escapes to the top level. */
  readonly exitCode: number;

  constructor(kind: ErrorKind, message: string, exitCode = 2) {
    super(message);
    this.name = kind;
    this.kind = kind;
    this.exitCode = exitCode;
  }

  toJSON(): { kind: ErrorKind; message: string } {
    return { kind: this.kind, message: this.message };
  }
}

export class UsageError extends DepCanaryError {
  constructor(message: string) {
    super("UsageError", message, 2);
  }
}

export class PackageNotFoundError extends DepCanaryError {
  constructor(message: string) {
    super("PackageNotFoundError", message, 2);
  }
}

export class VersionNotFoundError extends DepCanaryError {
  constructor(message: string) {
    super("VersionNotFoundError", message, 2);
  }
}

export class RegistryError extends DepCanaryError {
  constructor(message: string) {
    super("RegistryError", message, 2);
  }
}

export class IntegrityError extends DepCanaryError {
  constructor(message: string) {
    super("IntegrityError", message, 2);
  }
}

export class ArchiveSafetyError extends DepCanaryError {
  constructor(message: string) {
    super("ArchiveSafetyError", message, 2);
  }
}

export class AnalysisError extends DepCanaryError {
  constructor(message: string) {
    super("AnalysisError", message, 2);
  }
}

export class UnsupportedProjectError extends DepCanaryError {
  constructor(message: string) {
    super("UnsupportedProjectError", message, 2);
  }
}
