import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

export interface FakePackageVersion {
  version: string;
  manifest: Record<string, unknown>;
  files?: Record<string, string>;
  publishedBy?: string;
  /** When true, tarball bytes are corrupted after integrity is computed (for integrity failure tests). */
  corrupt?: boolean;
  /** Override the SRI integrity string the registry advertises (for malformed-integrity tests). */
  integrityOverride?: string;
  /** Raw tar entries to include verbatim, for archive-security adversarial fixtures. */
  rawEntries?: {
    path: string;
    content?: string;
    type?: "File" | "Directory" | "SymbolicLink";
    linkpath?: string;
  }[];
}

export interface FakePackageDef {
  name: string;
  versions: FakePackageVersion[];
  distTags?: Record<string, string>;
}

export interface FakeRegistry {
  url: string;
  close: () => Promise<void>;
}

const TYPEFLAG: Record<string, string> = {
  File: "0",
  Directory: "5",
  SymbolicLink: "2"
};

/**
 * Writes one raw USTAR header block (plus, for File entries, the padded
 * content) directly to `chunks`. This deliberately bypasses any tar-creation
 * library's own path sanitization so that adversarial fixtures (traversal
 * paths, absolute paths, symlink escapes) can be represented byte-for-byte
 * in the tarball the way a hostile publisher could produce one.
 */
function appendUstarEntry(
  chunks: Buffer[],
  entryPath: string,
  opts: { type?: "File" | "Directory" | "SymbolicLink"; content?: string; linkpath?: string } = {}
): void {
  const type = opts.type ?? "File";
  const content = type === "File" ? Buffer.from(opts.content ?? "") : Buffer.alloc(0);
  const header = Buffer.alloc(512);

  const writeField = (value: string, offset: number, length: number): void => {
    header.write(value, offset, length, "utf8");
  };
  const writeOctal = (value: number, offset: number, length: number): void => {
    const s = value.toString(8).padStart(length - 1, "0");
    header.write(s, offset, length - 1, "ascii");
    header[offset + length - 1] = 0;
  };

  // name: use the raw (possibly malicious) path verbatim, truncated to 100 bytes.
  writeField(entryPath.slice(0, 100), 0, 100);
  writeOctal(0o644, 100, 8); // mode
  writeOctal(0, 108, 8); // uid
  writeOctal(0, 116, 8); // gid
  writeOctal(content.length, 124, 12); // size
  writeOctal(0, 136, 12); // mtime
  header.write("        ", 148, 8, "ascii"); // chksum placeholder (8 spaces)
  header.write(TYPEFLAG[type] ?? "0", 156, 1, "ascii");
  if (opts.linkpath) writeField(opts.linkpath.slice(0, 100), 157, 100);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let sum = 0;
  for (const byte of header) sum += byte;
  const chksum = sum.toString(8).padStart(6, "0") + "\0 ";
  header.write(chksum, 148, 8, "ascii");

  chunks.push(header);
  if (content.length > 0) {
    chunks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) chunks.push(Buffer.alloc(pad));
  }
}

async function buildTarball(pkgName: string, ver: FakePackageVersion): Promise<Buffer> {
  const chunks: Buffer[] = [];

  appendUstarEntry(chunks, "package/package.json", {
    type: "File",
    content: JSON.stringify(ver.manifest, null, 2)
  });
  for (const [rel, content] of Object.entries(ver.files ?? {})) {
    appendUstarEntry(chunks, `package/${rel}`, { type: "File", content });
  }
  for (const entry of ver.rawEntries ?? []) {
    appendUstarEntry(chunks, entry.path, {
      type: entry.type ?? "File",
      ...(entry.content !== undefined ? { content: entry.content } : {}),
      ...(entry.linkpath !== undefined ? { linkpath: entry.linkpath } : {})
    });
  }

  // End-of-archive marker: two consecutive zero-filled 512-byte blocks.
  chunks.push(Buffer.alloc(1024));

  const raw = Buffer.concat(chunks);
  return zlib.gzipSync(raw);
}

export async function startFakeRegistry(packages: FakePackageDef[]): Promise<FakeRegistry> {
  const tarballCache = new Map<string, Buffer>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const segs = url.pathname.split("/").filter(Boolean);

      if (segs.length >= 1 && segs[segs.length - 1] === "corrupt.tgz") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from("not a real tarball"));
        return;
      }

      // tarball route: /<pkg>/-/<pkg>-<version>.tgz
      if (segs.length >= 3 && segs[segs.length - 2] === "-") {
        const pkgName = decodeURIComponent(segs.slice(0, segs.length - 2).join("/"));
        const fileName = segs[segs.length - 1]!;
        const key = `${pkgName}/${fileName}`;
        const cached = tarballCache.get(key);
        if (!cached) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(cached);
        return;
      }

      if (segs.length === 1) {
        const pkgName = decodeURIComponent(segs[0]!);
        const def = packages.find((p) => p.name === pkgName);
        if (!def) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        const versions: Record<string, unknown> = {};
        for (const v of def.versions) {
          const tarball = await buildTarball(pkgName, v);
          let bytes = tarball;
          const integrity =
            v.integrityOverride ??
            `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
          if (v.corrupt) {
            bytes = Buffer.concat([tarball, Buffer.from("corruption")]);
          }
          const fileName = `${pkgName.replace("/", "-")}-${v.version}.tgz`;
          tarballCache.set(`${pkgName}/${fileName}`, bytes);
          versions[v.version] = {
            ...v.manifest,
            name: pkgName,
            version: v.version,
            dist: {
              tarball: `http://localhost:${(server.address() as { port: number }).port}/${pkgName}/-/${fileName}`,
              integrity
            },
            ...(v.publishedBy ? { _npmUser: { name: v.publishedBy } } : {})
          };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: pkgName,
            "dist-tags": def.distTags ?? { latest: def.versions[def.versions.length - 1]!.version },
            versions,
            time: Object.fromEntries(
              def.versions.map((v) => [v.version, new Date(0).toISOString()])
            )
          })
        );
        return;
      }

      res.writeHead(404).end("not found");
    })().catch((err) => {
      res.writeHead(500).end(String(err));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}
