import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requiredEnv } from "../shared/env.mjs";
import { redactTokens } from "../shared/redact.mjs";
import { removeGeneratedDirectories } from "../shared/turbo-fixture.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, "fixtures", "sample-monorepo");
const token = requiredEnv("TURBOFLARE_TOKEN");
const adminToken = requiredEnv("TURBOFLARE_ADMIN_TOKEN");
const baseHost = requiredEnv("TURBOFLARE_HOST");
const versions = (process.env.TURBOFLARE_TURBO_VERSIONS ?? "2.6.1,2.9.16").split(",");
const protocols = ["http", "https"];
const results = [];

for (const version of versions) {
  for (const protocol of protocols) {
    const fixture = await mkdtemp(join(tmpdir(), "turboflare-matrix-"));
    const api = `${protocol}://${baseHost}`;
    const team = `matrix-${version.replaceAll(".", "-")}-${protocol}-${Date.now()}`;
    try {
      await cp(FIXTURE_ROOT, fixture, { recursive: true });
      await run("pnpm", ["install", "--frozen-lockfile"], fixture);
      const first = await runTurbo(version, fixture, api, team, "local:,remote:w");
      await removeGeneratedDirectories(fixture);
      const second = await runTurbo(version, fixture, api, team, "local:,remote:r");
      results.push(result(version, protocol, first, second));
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : String(error),
        protocol,
        version,
        ok: false,
      });
    } finally {
      await purge(api, team).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
      await rm(fixture, { force: true, recursive: true });
    }
  }
}

console.log(JSON.stringify({ results }, null, 2));
if (results.some((entry) => !entry.ok)) {
  process.exitCode = 1;
}

function runTurbo(version, cwd, api, team, cache) {
  return run(
    "pnpm",
    [
      "dlx",
      `turbo@${version}`,
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

function result(version, protocol, first, second) {
  const firstEnabled = /Remote caching enabled/i.test(first.stdout);
  const secondHit = /cache hit/i.test(second.stdout);
  return {
    firstEnabled,
    firstStderr: redactTokens(first.stderr, [token]),
    firstSummary: summary(first.stdout),
    ok: firstEnabled && secondHit,
    protocol,
    secondHit,
    secondStderr: redactTokens(second.stderr, [token]),
    secondSummary: summary(second.stdout),
    version,
  };
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, env: { ...process.env, ...env }, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new Error(
              `${command} ${args.join(" ")} failed\n${redactTokens(stdout, [token])}\n${redactTokens(stderr, [token])}`,
            ),
          );
          return;
        }
        resolve({ stderr, stdout });
      },
    );
  });
}

async function purge(api, team) {
  const response = await fetch(`${api}/internal/teams/${encodeURIComponent(team)}/purge-all`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`purge failed for ${team}: ${response.status}`);
  }
}

function summary(value) {
  return redactTokens(
    value
      .split(/\r?\n/)
      .filter((line) =>
        /Remote caching|cache miss|cache hit|Tasks:|Cached:|Time:|unavailable|Could not connect/i.test(
          line,
        ),
      )
      .join("\n"),
    [token],
  );
}
