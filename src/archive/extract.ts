import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { Readable } from "node:stream";
import { LIMITS } from "../constants.js";
import { ArchiveSafetyError } from "../errors/errors.js";
import { sanitizeEntryPath } from "./safety.js";

export interface ExtractedFile {
  /** Package-relative path, forward-slash separated. */
  relPath: string;
  /** Absolute path on disk inside the temp extraction root. */
  absPath: string;
  size: number;
  mode: number;
}

export interface ExtractedArchive {
  root: string;
  files: ExtractedFile[];
  totalBytes: number;
  cleanup: () => Promise<void>;
}

/**
 * Extracts an npm tarball into a fresh, DepCanary-controlled temp directory.
 * Refuses to write anything outside that directory. Never executes anything.
 * Symlinks/hardlinks are recorded as metadata only and never followed/created,
 * eliminating an entire class of symlink-escape attacks.
 */
export async function extractTarballSafely(buffer: Buffer): Promise<ExtractedArchive> {
  const root = await mkdtemp(path.join(tmpdir(), "depcanary-"));
  const files: ExtractedFile[] = [];
  let totalBytes = 0;
  let entryCount = 0;

  const cleanup = async (): Promise<void> => {
    await rm(root, { recursive: true, force: true });
  };

  try {
    const parser = new tar.Parser({});
    let firstError: unknown;
    const finished = new Promise<void>((resolve, reject) => {
      parser.on("error", reject);
      parser.on("end", resolve);
    });
    // Swallow rejections on `finished` here so they are never left unconsumed if this
    // promise settles before the per-entry `pending` tasks below are awaited - the
    // canonical error is captured in `firstError` and re-thrown after everything settles.
    finished.catch(() => {});
    const pending: Promise<void>[] = [];

    parser.on("entry", (entry: tar.ReadEntry) => {
      const task = (async () => {
        entryCount += 1;
        if (entryCount > LIMITS.MAX_ARCHIVE_FILES) {
          entry.resume();
          throw new ArchiveSafetyError(
            `Archive exceeds maximum file count (${LIMITS.MAX_ARCHIVE_FILES})`
          );
        }

        let relPath: string;
        try {
          relPath = sanitizeEntryPath(entry.path);
        } catch (err) {
          entry.resume();
          throw err;
        }

        // Never materialize symlinks/hardlinks/devices - treat as metadata-only, skip bytes.
        if (entry.type !== "File" && entry.type !== "Directory") {
          entry.resume();
          return;
        }

        const destPath = path.join(root, relPath);
        const resolvedDest = path.resolve(destPath);
        if (
          !resolvedDest.startsWith(path.resolve(root) + path.sep) &&
          resolvedDest !== path.resolve(root)
        ) {
          entry.resume();
          throw new ArchiveSafetyError(`Resolved path escapes root: ${relPath}`);
        }

        if (entry.type === "Directory") {
          await mkdir(resolvedDest, { recursive: true });
          entry.resume();
          return;
        }

        // The bare top-level "package" entry (relPath === ".") is the root itself, which
        // already exists; there is nothing further to write for it even if npm/tar emits
        // it as a non-Directory entry type.
        if (relPath === ".") {
          entry.resume();
          return;
        }

        const size = entry.size ?? 0;
        if (size > LIMITS.MAX_ENTRY_BYTES) {
          entry.resume();
          throw new ArchiveSafetyError(
            `Archive entry exceeds max size: ${relPath} (${size} bytes)`
          );
        }
        totalBytes += size;
        if (totalBytes > LIMITS.MAX_EXTRACTED_BYTES) {
          entry.resume();
          throw new ArchiveSafetyError(`Archive exceeds maximum total extracted bytes`);
        }

        await mkdir(path.dirname(resolvedDest), { recursive: true });
        const chunks: Buffer[] = [];
        entry.on("data", (c: Buffer) => chunks.push(c));
        await new Promise<void>((res, rej) => {
          entry.on("end", () => res());
          entry.on("error", rej);
        });
        const data = Buffer.concat(chunks);
        await writeFile(resolvedDest, data, { mode: 0o600 });
        files.push({
          relPath,
          absPath: resolvedDest,
          size: data.length,
          mode: entry.mode ?? 0o644
        });
      })().catch((err) => {
        // Record the failure and abort the stream promptly (in case it is still
        // flowing), but never re-throw here: this handler's return value feeds
        // `pending` below, and a task promise that stays rejected past that point
        // would be an unconsumed ("unhandled") rejection once `finished` settles
        // first and short-circuits the normal await path.
        if (firstError === undefined) firstError = err;
        parser.emit("error", err);
      });
      pending.push(task);
    });

    Readable.from(buffer).pipe(parser);
    await finished;
    // The parser's "end"/"error" events fire once the underlying stream has been
    // fully consumed, but per-entry processing (sanitization, mkdir, write) happens
    // in detached async tasks kicked off from the "entry" handler above. Wait for
    // all of them to settle before returning, otherwise callers can observe a
    // partially-populated (or empty) `files` array, or a swallowed failure, despite
    // extraction appearing to "succeed". These tasks never reject (see above), so
    // Promise.all is safe here and cannot itself introduce another floating rejection.
    await Promise.all(pending);
    if (firstError !== undefined) throw firstError;
  } catch (err) {
    await cleanup();
    if (err instanceof ArchiveSafetyError) throw err;
    throw new ArchiveSafetyError(`Failed to extract archive: ${String(err)}`);
  }

  return { root, files, totalBytes, cleanup };
}
