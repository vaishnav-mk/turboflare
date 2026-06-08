import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "vitest";

import { handleRequest, type Env } from "../src";

interface TestServer {
  close: () => Promise<void>;
  url: string;
}

interface StoredObject {
  body: Uint8Array<ArrayBuffer>;
  customMetadata?: Record<string, string>;
  etag: string;
  httpMetadata?: R2HTTPMetadata;
  key: string;
  uploaded: Date;
}

interface TurboFixture {
  directory: string;
}

interface TurboRunOptions {
  extraEnv?: NodeJS.ProcessEnv;
  teamEnv?: NodeJS.ProcessEnv;
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const SAMPLE_FIXTURE_ROOT = join(REPO_ROOT, "fixtures", "sample-monorepo");
const TURBO_BIN = join(REPO_ROOT, "node_modules", ".bin", "turbo");
const TURBO_TOKEN = "fixture-token";
const TURBO_TEAM = "team_fixture";
const GENERATED_DIRECTORIES = new Set([".next", ".turbo", "dist", "node_modules"]);
const TURBO_ENV_KEYS = [
  "TURBO_API",
  "TURBO_CACHE",
  "TURBO_PREFLIGHT",
  "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
  "TURBO_TEAM",
  "TURBO_TEAMID",
  "TURBO_TOKEN",
];

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
});

describe("real turbo fixture", () => {
  it("restores a sample monorepo from remote cache on the second run", async ({ expect }) => {
    const artifacts = new MemoryR2Bucket();
    const server = await startWorkerServer({
      ARTIFACTS: artifacts as unknown as R2Bucket,
      TURBO_TOKEN,
    });
    cleanupTasks.push(server.close);

    const fixture = await createTurboFixture();
    cleanupTasks.push(() => rm(fixture.directory, { force: true, recursive: true }));

    const first = await runTurbo(fixture, server.url);
    expect(first.stdout).toMatch(/cache miss/i);
    const firstHashes = cacheHashes(first.stdout);
    expect(firstHashes.length).toBeGreaterThanOrEqual(6);
    expect(artifacts.objects.size).toBeGreaterThanOrEqual(6);

    await removeGeneratedDirectories(fixture.directory);
    const gitStatus = await runProcess("git", ["status", "--porcelain"], fixture.directory);
    expect(gitStatus.stdout).toBe("");

    const second = await runTurbo(fixture, server.url);
    expect(cacheHashes(second.stdout)).toEqual(firstHashes);
    expect(second.stdout).toMatch(/cache hit/i);
    await expectNonEmptyDirectory(join(fixture.directory, "apps", "web", ".next"));
    await expectNonEmptyDirectory(join(fixture.directory, "apps", "api", "dist"));
    await expectNonEmptyDirectory(join(fixture.directory, "apps", "docs", "dist"));
    await expectNonEmptyDirectory(join(fixture.directory, "apps", "dashboard", "dist"));
    await expectNonEmptyDirectory(join(fixture.directory, "packages", "ui", "dist"));
    await expectNonEmptyDirectory(join(fixture.directory, "packages", "math", "dist"));
  });

  it("supports team id, preflight, signature, and remote-read modes", async ({ expect }) => {
    const artifacts = new MemoryR2Bucket();
    const server = await startWorkerServer({
      ARTIFACTS: artifacts as unknown as R2Bucket,
      TURBO_TOKEN,
    });
    cleanupTasks.push(server.close);

    const fixture = await createTurboFixture();
    cleanupTasks.push(() => rm(fixture.directory, { force: true, recursive: true }));

    const first = await runTurbo(fixture, server.url, {
      extraEnv: { TURBO_PREFLIGHT: "true", TURBO_REMOTE_CACHE_SIGNATURE_KEY: "x".repeat(32) },
      teamEnv: { TURBO_TEAMID: "team_fixture_id" },
    });
    expect(first.stdout).toMatch(/cache miss/i);
    const firstHashes = cacheHashes(first.stdout);
    expect(firstHashes.length).toBeGreaterThanOrEqual(6);

    await removeGeneratedDirectories(fixture.directory);
    const gitStatus = await runProcess("git", ["status", "--porcelain"], fixture.directory);
    expect(gitStatus.stdout).toBe("");

    const second = await runTurbo(fixture, server.url, {
      extraEnv: {
        TURBO_CACHE: "local:,remote:r",
        TURBO_PREFLIGHT: "true",
        TURBO_REMOTE_CACHE_SIGNATURE_KEY: "x".repeat(32),
      },
      teamEnv: { TURBO_TEAMID: "team_fixture_id" },
    });
    expect(cacheHashes(second.stdout)).toEqual(firstHashes);
    expect(second.stdout).toMatch(/cache hit/i);
    await expectNonEmptyDirectory(join(fixture.directory, "apps", "web", ".next"));
  });

  it("does not enable remote caching without a team", async ({ expect }) => {
    const artifacts = new MemoryR2Bucket();
    const server = await startWorkerServer({
      ARTIFACTS: artifacts as unknown as R2Bucket,
      TURBO_TOKEN,
    });
    cleanupTasks.push(server.close);

    const fixture = await createTurboFixture();
    cleanupTasks.push(() => rm(fixture.directory, { force: true, recursive: true }));

    const result = await runTurbo(fixture, server.url, { teamEnv: {} });
    expect(result.stdout).toMatch(/Remote caching disabled/i);
    expect(result.stdout).toMatch(/cache bypass/i);
    expect(artifacts.objects.size).toBe(0);
  });
});

async function createTurboFixture(): Promise<TurboFixture> {
  const directory = await mkdtemp(join(tmpdir(), "turboflare-turbo-"));
  await cp(SAMPLE_FIXTURE_ROOT, directory, { recursive: true });
  await runProcess("pnpm", ["install", "--frozen-lockfile"], directory);
  await runProcess("git", ["init"], directory);
  await runProcess("git", ["add", "."], directory);
  await runProcess(
    "git",
    [
      "-c",
      "user.email=turboflare@example.com",
      "-c",
      "user.name=turboflare",
      "commit",
      "-m",
      "init",
    ],
    directory,
  );
  return { directory };
}

function cacheHashes(stdout: string): string[] {
  const matches = [...stdout.matchAll(/cache (?:miss|hit).*?([a-f0-9]{16})/gi)]
    .map((match) => match[1])
    .sort();
  if (matches.length === 0) {
    throw new Error(stdout);
  }

  return matches;
}

function runTurbo(
  fixture: TurboFixture,
  turboApi: string,
  options: TurboRunOptions = {},
): Promise<{ stderr: string; stdout: string }> {
  const teamEnv = options.teamEnv ?? { TURBO_TEAM };

  return runProcess(TURBO_BIN, ["run", "build", "--output-logs=full"], fixture.directory, {
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    TURBO_API: turboApi,
    TURBO_CACHE: "remote:rw",
    ...teamEnv,
    TURBO_TELEMETRY_DISABLED: "1",
    TURBO_TOKEN,
    ...options.extraEnv,
  });
}

async function removeGeneratedDirectories(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (!entry.isDirectory()) {
        return;
      }

      if (GENERATED_DIRECTORIES.has(entry.name)) {
        await rm(path, { force: true, recursive: true });
        return;
      }

      await removeGeneratedDirectories(path);
    }),
  );
}

async function expectNonEmptyDirectory(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) {
    throw new Error(`${path} is not a directory`);
  }

  const entries = await readdir(path);
  if (entries.length === 0) {
    throw new Error(`${path} is empty`);
  }
}

function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { cwd, env: { ...scrubTurboEnv(process.env), ...env } },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
          return;
        }

        resolve({ stderr, stdout });
      },
    );
  });
}

function scrubTurboEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of TURBO_ENV_KEYS) {
    delete clean[key];
  }

  return clean;
}

function startWorkerServer(env: Env): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (incoming, outgoing) => {
      try {
        const request = toRequest(incoming);
        const response = await handleRequest(request, env, executionContext());
        await writeResponse(outgoing, response);
      } catch (error) {
        outgoing.statusCode = 500;
        outgoing.end(error instanceof Error ? error.message : "internal error");
      }
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("server did not bind to a tcp port"));
        return;
      }

      const serverUrl = `http://127.0.0.1:${address.port}`;
      resolve({ close: () => closeServer(server), url: serverUrl });
    });
  });
}

function toRequest(incoming: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value === undefined) {
      continue;
    }

    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const url = `http://${incoming.headers.host}${incoming.url ?? "/"}`;
  const method = incoming.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming);
  return new Request(url, { body, duplex: "half", headers, method } as RequestInit & {
    duplex: "half";
  });
}

async function writeResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));

  if (response.body === null) {
    outgoing.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
      .on("error", reject)
      .pipe(outgoing)
      .on("error", reject)
      .on("finish", resolve);
  });
}

function executionContext(): ExecutionContext {
  return {
    passThroughOnException() {},
    waitUntil(promise) {
      void promise;
    },
  } as ExecutionContext;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

class MemoryR2Bucket {
  readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    const body = await bodyBytes(value);
    const object = storedObject(key, body, options);
    this.objects.set(key, object);
    return r2Object(object);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const object = this.objects.get(key);
    return object === undefined ? null : r2ObjectBody(object);
  }

  async head(key: string): Promise<R2Object | null> {
    const object = this.objects.get(key);
    return object === undefined ? null : r2Object(object);
  }
}

async function bodyBytes(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
): Promise<Uint8Array<ArrayBuffer>> {
  if (value === null) {
    return new Uint8Array();
  }

  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }

  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return copyBytes(view);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  const response = new Response(value);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function storedObject(
  key: string,
  body: Uint8Array<ArrayBuffer>,
  options: R2PutOptions | undefined,
): StoredObject {
  return {
    body,
    customMetadata: options?.customMetadata,
    etag: crypto.randomUUID().replaceAll("-", ""),
    httpMetadata: r2HttpMetadata(options?.httpMetadata),
    key,
    uploaded: new Date(),
  };
}

function r2HttpMetadata(
  metadata: Headers | R2HTTPMetadata | undefined,
): R2HTTPMetadata | undefined {
  return metadata instanceof Headers
    ? { contentType: metadata.get("Content-Type") ?? undefined }
    : metadata;
}

function r2Object(object: StoredObject): R2Object {
  return {
    checksums: {} as R2Checksums,
    customMetadata: object.customMetadata,
    etag: object.etag,
    httpEtag: `"${object.etag}"`,
    httpMetadata: object.httpMetadata,
    key: object.key,
    size: object.body.byteLength,
    uploaded: object.uploaded,
    version: object.etag,
    writeHttpMetadata(headers) {
      if (object.httpMetadata?.contentType !== undefined) {
        headers.set("Content-Type", object.httpMetadata.contentType);
      }
    },
  } as R2Object;
}

function r2ObjectBody(object: StoredObject): R2ObjectBody {
  return {
    ...r2Object(object),
    body: new Response(object.body).body,
    bodyUsed: false,
    arrayBuffer: () =>
      Promise.resolve(
        object.body.buffer.slice(
          object.body.byteOffset,
          object.body.byteOffset + object.body.byteLength,
        ),
      ),
    blob: () => Promise.resolve(new Blob([object.body])),
    json: async () => JSON.parse(await new Response(object.body).text()) as unknown,
    text: () => new Response(object.body).text(),
  } as R2ObjectBody;
}
