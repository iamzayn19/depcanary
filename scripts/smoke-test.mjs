#!/usr/bin/env node
// Packs the real npm tarball, installs it into a fresh temp project OUTSIDE
// the repository, and exercises the installed CLI + public library API.
// This proves the artifact users will actually receive, not src/.

import { execFileSync, spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

function log(msg) {
  process.stderr.write(`[smoke] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? "");
    process.stderr.write(res.stderr ?? "");
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
  }
  return res.stdout;
}

// Async variant: required whenever a request must be served by an HTTP
// server running in *this* process while the child is running, since
// spawnSync would block this process's event loop and deadlock the server.
function runAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        process.stderr.write(stdout);
        process.stderr.write(stderr);
        reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// --- minimal fake registry (same tar-building approach as tests) ---
function appendUstarEntry(chunks, entryPath, content) {
  const buf = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(entryPath.slice(0, 100), 0, 100, "utf8");
  const writeOctal = (value, offset, length) => {
    header.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
    header[offset + length - 1] = 0;
  };
  writeOctal(0o644, 100, 8);
  writeOctal(0, 108, 8);
  writeOctal(0, 116, 8);
  writeOctal(buf.length, 124, 12);
  writeOctal(0, 136, 12);
  header.write("        ", 148, 8, "ascii");
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  chunks.push(header, buf);
  const pad = (512 - (buf.length % 512)) % 512;
  if (pad > 0) chunks.push(Buffer.alloc(pad));
}

function buildTarball(manifest) {
  const chunks = [];
  appendUstarEntry(chunks, "package/package.json", JSON.stringify(manifest, null, 2));
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

async function startFakeRegistry() {
  const oldManifest = { name: "smoke-pkg", version: "1.0.0" };
  const newManifest = {
    name: "smoke-pkg",
    version: "1.1.0",
    scripts: { postinstall: "node setup.js" }
  };
  const oldTar = buildTarball(oldManifest);
  const newTar = buildTarball(newManifest);
  const oldIntegrity = `sha512-${createHash("sha512").update(oldTar).digest("base64")}`;
  const newIntegrity = `sha512-${createHash("sha512").update(newTar).digest("base64")}`;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/smoke-pkg/-/smoke-pkg-1.0.0.tgz") {
      res.writeHead(200).end(oldTar);
      return;
    }
    if (url.pathname === "/smoke-pkg/-/smoke-pkg-1.1.0.tgz") {
      res.writeHead(200).end(newTar);
      return;
    }
    if (url.pathname === "/smoke-pkg") {
      const port = server.address().port;
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          name: "smoke-pkg",
          "dist-tags": { latest: "1.1.0" },
          versions: {
            "1.0.0": {
              ...oldManifest,
              dist: {
                tarball: `http://127.0.0.1:${port}/smoke-pkg/-/smoke-pkg-1.0.0.tgz`,
                integrity: oldIntegrity
              }
            },
            "1.1.0": {
              ...newManifest,
              dist: {
                tarball: `http://127.0.0.1:${port}/smoke-pkg/-/smoke-pkg-1.1.0.tgz`,
                integrity: newIntegrity
              }
            }
          }
        })
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

async function main() {
  log("building...");
  run("npm", ["run", "build"], { cwd: repoRoot });

  log("packing...");
  const packOut = run("npm", ["pack", "--json"], { cwd: repoRoot });
  // prepack (npm run check) writes its own stdout before npm's JSON output;
  // the JSON payload is the final well-formed `[ ... ]` array in the stream.
  const jsonStart = packOut.lastIndexOf("\n[");
  const jsonText = jsonStart === -1 ? packOut : packOut.slice(jsonStart + 1);
  const [packInfo] = JSON.parse(jsonText);
  const tarballName = packInfo.filename;
  const tarballAbsPath = path.join(repoRoot, tarballName);
  log(`packed ${tarballName} (${packInfo.size} bytes, ${packInfo.entryCount} entries)`);

  const forbidden = ["test/", "fixtures/", ".github/", "coverage/"];
  for (const entry of packInfo.files) {
    for (const bad of forbidden) {
      if (entry.path.startsWith(bad)) {
        throw new Error(`Packed tarball unexpectedly contains ${entry.path}`);
      }
    }
  }
  log("tarball contents verified clean (no test/fixtures/.github/coverage)");

  const tmpProject = mkdtempSync(path.join(tmpdir(), "depcanary-smoke-"));
  let registry;
  try {
    log(`installing into clean project at ${tmpProject}`);
    writeFileSync(
      path.join(tmpProject, "package.json"),
      JSON.stringify({ name: "smoke-consumer", version: "1.0.0", private: true })
    );
    execFileSync("npm", ["install", tarballAbsPath], { cwd: tmpProject, stdio: "inherit" });

    const binPath = path.join(tmpProject, "node_modules", ".bin", "depcanary");
    const version = run(binPath, ["--version"]).trim();
    log(`installed CLI --version -> ${version}`);
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("unexpected --version output");

    const help = run(binPath, ["--help"]);
    if (!help.includes("Examples:")) throw new Error("--help missing Examples section");
    log("--help OK");

    registry = await startFakeRegistry();
    const diffOut = await runAsync(binPath, [
      "smoke-pkg@1.0.0",
      "smoke-pkg@1.1.0",
      "--registry",
      registry.url,
      "--no-color"
    ]);
    if (!diffOut.includes("smoke-pkg")) throw new Error("comparison output missing package name");
    log("real comparison against local fake registry OK");

    const apiCheck = spawnSync(
      process.execPath,
      [
        "-e",
        "import('depcanary').then(m => { if (typeof m.compare !== 'function') throw new Error('compare not exported'); console.log('ok'); })"
      ],
      { cwd: tmpProject, encoding: "utf8" }
    );
    if (apiCheck.status !== 0 || !apiCheck.stdout.includes("ok")) {
      throw new Error(`public API import check failed: ${apiCheck.stderr}`);
    }
    log("public library API (compare) import OK");
  } finally {
    if (registry) await registry.close();
    rmSync(tmpProject, { recursive: true, force: true });
    rmSync(tarballAbsPath, { force: true });
  }

  log("smoke test passed.");
}

main().catch((err) => {
  process.stderr.write(`[smoke] FAILED: ${err.stack ?? err}\n`);
  process.exit(1);
});
