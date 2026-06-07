import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requiredEnv } from "../shared/env.mjs";
import { redactTokens } from "../shared/redact.mjs";
import { removeGeneratedDirectories } from "../shared/turbo-fixture.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, "fixtures", "complex-turbo-monorepo");
const TURBO_BIN = join(REPO_ROOT, "node_modules", ".bin", "turbo");
const target = requiredEnv("TURBOFLARE_R2_API");
const token = requiredEnv("TURBOFLARE_TOKEN");
const secretTokens = [token];
const team = `proxy-smoke-${Date.now()}`;

const requests = [];
const proxy = await startProxy(target, requests);
const fixture = await mkdtemp(join(tmpdir(), "turboflare-proxy-smoke-"));

try {
  await cp(FIXTURE_ROOT, fixture, { recursive: true });
  await run("pnpm", ["install", "--frozen-lockfile"], fixture);
  const first = await runTurbo(fixture, proxy.url, token, team, "remote:rw");
  await removeGeneratedDirectories(fixture);
  const second = await runTurbo(fixture, proxy.url, token, team, "remote:r");
  assert(/cache miss/i.test(first.stdout), "expected first run to miss remote cache");
  assert(/cache hit/i.test(second.stdout), "expected second run to hit remote cache");
  console.log(
    JSON.stringify({ first: summarize(first), requests, second: summarize(second), team }, null, 2),
  );
} finally {
  await proxy.close();
  await rm(fixture, { force: true, recursive: true });
}

function startProxy(target, requests) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (incoming, outgoing) => {
      const url = new URL(incoming.url ?? "/", target);
      const started = Date.now();
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) {
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
        }
        headers.set("host", new URL(target).host);
        const method = incoming.method ?? "GET";
        const response = await fetch(url, {
          body: method === "GET" || method === "HEAD" ? undefined : incoming,
          duplex: "half",
          headers,
          method,
        });
        requests.push({
          durationMs: Date.now() - started,
          method,
          path: url.pathname,
          search: url.search,
          status: response.status,
        });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        if (response.body === null) {
          outgoing.end();
          return;
        }
        const body = new Uint8Array(await response.arrayBuffer());
        outgoing.end(body);
      } catch (error) {
        requests.push({
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
          method: incoming.method,
          path: url.pathname,
          search: url.search,
          status: 599,
        });
        outgoing.statusCode = 599;
        outgoing.end("proxy error");
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve({
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function runTurbo(cwd, api, token, team, cache) {
  return run(
    TURBO_BIN,
    [
      "run",
      "build",
      "--filter=@fixture/math",
      "--output-logs=full",
      "--remote-cache-timeout",
      "20",
      "--cache",
      cache,
    ],
    cwd,
    {
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TURBO_API: api,
      TURBO_TEAM: team,
      TURBO_TELEMETRY_DISABLED: "1",
      TURBO_TOKEN: token,
    },
  );
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const result = { stderr, stdout };
      if (error !== null) {
        const output = redactTokens(`${stdout}\n${stderr}`, secretTokens);
        reject(new Error(`${error.message}\n${output}`));
        return;
      }
      resolve(result);
    });
  });
}

function summarize(result) {
  return {
    stderr: redactTokens(result.stderr, secretTokens),
    stdout: redactTokens(
      result.stdout
        .split(/\r?\n/)
        .filter((line) => /cache|Cached|Remote|Tasks|Time/i.test(line))
        .join("\n"),
      secretTokens,
    ),
  };
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}
