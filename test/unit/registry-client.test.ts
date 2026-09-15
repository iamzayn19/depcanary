import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryClient, resolveRegistryUrl } from "../../src/registry/client.js";
import { RegistryError, VersionNotFoundError } from "../../src/errors/errors.js";

let server: Server | undefined;

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe("resolveRegistryUrl precedence", () => {
  it("prefers the explicit argument over env vars", () => {
    const prevNpm = process.env["npm_config_registry"];
    process.env["npm_config_registry"] = "http://env-registry.invalid";
    try {
      expect(resolveRegistryUrl("http://explicit.invalid")).toBe("http://explicit.invalid");
    } finally {
      if (prevNpm === undefined) delete process.env["npm_config_registry"];
      else process.env["npm_config_registry"] = prevNpm;
    }
  });

  it("falls back to npm_config_registry, then NPM_CONFIG_REGISTRY, then the default", () => {
    const prevLower = process.env["npm_config_registry"];
    const prevUpper = process.env["NPM_CONFIG_REGISTRY"];
    delete process.env["npm_config_registry"];
    delete process.env["NPM_CONFIG_REGISTRY"];
    try {
      expect(resolveRegistryUrl()).toBe("https://registry.npmjs.org");
      process.env["NPM_CONFIG_REGISTRY"] = "http://upper.invalid";
      expect(resolveRegistryUrl()).toBe("http://upper.invalid");
      process.env["npm_config_registry"] = "http://lower.invalid";
      expect(resolveRegistryUrl()).toBe("http://lower.invalid");
    } finally {
      if (prevLower === undefined) delete process.env["npm_config_registry"];
      else process.env["npm_config_registry"] = prevLower;
      if (prevUpper === undefined) delete process.env["NPM_CONFIG_REGISTRY"];
      else process.env["NPM_CONFIG_REGISTRY"] = prevUpper;
    }
  });
});

describe("RegistryClient — HTTP edge cases", () => {
  it("follows a redirect chain to the final response", async () => {
    const url = await listen((req, res) => {
      if (req.url === "/pkg") {
        res.writeHead(302, { location: "/pkg-2" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: "pkg",
          versions: {
            "1.0.0": { name: "pkg", version: "1.0.0", dist: { tarball: "http://x/pkg.tgz" } }
          }
        })
      );
    });
    const client = new RegistryClient({ registry: url });
    const packument = await client.fetchPackument("pkg");
    expect(packument.name).toBe("pkg");
  });

  it("throws RegistryError on a redirect with a missing Location header", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(302);
      res.end();
    });
    const client = new RegistryClient({ registry: url });
    await expect(client.fetchPackument("pkg")).rejects.toThrow(RegistryError);
  });

  it("throws RegistryError after exceeding the max redirect count", async () => {
    const url = await listen((req, res) => {
      res.writeHead(302, { location: req.url });
      res.end();
    });
    const client = new RegistryClient({ registry: url, maxRedirects: 1 });
    await expect(client.fetchPackument("pkg")).rejects.toThrow(/Too many redirects/);
  });

  it("throws RegistryError on a non-2xx, non-404 status", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    const client = new RegistryClient({ registry: url });
    await expect(client.fetchPackument("pkg")).rejects.toThrow(RegistryError);
  });

  it("throws RegistryError on invalid JSON from the registry", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("not json{{{");
    });
    const client = new RegistryClient({ registry: url });
    await expect(client.fetchPackument("pkg")).rejects.toThrow(RegistryError);
  });

  it("throws RegistryError for a network-level failure", async () => {
    const client = new RegistryClient({ registry: "http://127.0.0.1:1" });
    await expect(client.fetchPackument("pkg")).rejects.toThrow(RegistryError);
  });

  it("resolveVersion resolves a dist-tag to a concrete version", async () => {
    const client = new RegistryClient();
    const meta = client.resolveVersion(
      {
        name: "pkg",
        "dist-tags": { next: "2.0.0" },
        versions: {
          "2.0.0": { name: "pkg", version: "2.0.0", dist: { tarball: "http://x/pkg.tgz" } }
        }
      },
      "next"
    );
    expect(meta.version).toBe("2.0.0");
  });

  it("resolveVersion throws VersionNotFoundError for an unknown version", async () => {
    const client = new RegistryClient();
    expect(() => client.resolveVersion({ name: "pkg", versions: {} }, "9.9.9")).toThrow(
      VersionNotFoundError
    );
  });

  it("downloadTarball rejects a non-HTTP(S) tarball URL", async () => {
    const client = new RegistryClient();
    await expect(client.downloadTarball({ tarball: "file:///etc/passwd" })).rejects.toThrow(
      RegistryError
    );
  });

  it("downloadTarball throws RegistryError on a non-ok download response", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const client = new RegistryClient();
    await expect(client.downloadTarball({ tarball: `${url}/missing.tgz` })).rejects.toThrow(
      RegistryError
    );
  });
});
