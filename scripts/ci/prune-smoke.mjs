import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { requiredEnv } from "../shared/env.mjs";
import { redactTokens } from "../shared/redact.mjs";
import { removeGeneratedDirectories } from "../shared/turbo-fixture.mjs";

const target = process.argv[2];
const task = process.argv[3] ?? "build";
if (target === undefined) {
  throw new Error("usage: node scripts/ci/prune-smoke.mjs <target-package> [task]");
}

const turboApi = requiredEnv("TURBO_API");
const turboToken = requiredEnv("TURBO_TOKEN");
const turboTeam = requiredEnv("TURBO_TEAM");
const secretTokens = [turboToken];

const cwd = resolve(process.env.PRUNE_CWD ?? process.cwd());
const turboBin = resolve(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "turbo.cmd" : "turbo",
);
const outDir = await mkdtemp(join(tmpdir(), "turboflare-prune-"));
const fullDir = join(outDir, "full");

try {
  await run(turboBin, ["prune", target, "--docker", "--out-dir", outDir], cwd);
  await copyFile(join(outDir, "pnpm-lock.yaml"), join(fullDir, "pnpm-lock.yaml"));
  await run("pnpm", ["install", "--frozen-lockfile"], fullDir);
  await run("git", ["init"], fullDir);
  await run("git", ["add", "."], fullDir);
  await run(
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
    fullDir,
  );

  const first = await run(
    turboBin,
    [
      "run",
      task,
      "--filter",
      `${target}...`,
      "--cache=local:,remote:w",
      "--remote-cache-timeout",
      "20",
      "--output-logs=full",
    ],
    fullDir,
  );
  if (!/cache (?:miss|bypass)/i.test(first.stdout)) {
    throw new Error(`expected pruned first run to execute\n${first.stdout}`);
  }

  await removeGeneratedDirectories(fullDir);

  const second = await run(
    turboBin,
    [
      "run",
      task,
      "--filter",
      `${target}...`,
      "--cache=local:,remote:r",
      "--remote-cache-timeout",
      "20",
      "--output-logs=full",
    ],
    fullDir,
  );
  if (!/cache hit/i.test(second.stdout)) {
    throw new Error(`expected pruned second run to hit\n${second.stdout}`);
  }

  console.log(JSON.stringify({ ok: true, target, task }, null, 2));
} finally {
  await rm(outDir, { force: true, recursive: true });
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    console.log(`${command} ${args.join(" ")}`);
    execFile(
      command,
      args,
      {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          TURBO_API: turboApi,
          TURBO_TEAM: turboTeam,
          TURBO_TELEMETRY_DISABLED: "1",
          TURBO_TOKEN: turboToken,
        },
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - started;
        console.log(
          JSON.stringify(
            { command, args, durationMs, cwd, stdout: summary(stdout), stderr: summary(stderr) },
            null,
            2,
          ),
        );
        if (error !== null) {
          reject(
            new Error(
              `${error.message}\n${redactTokens(stdout, secretTokens)}\n${redactTokens(stderr, secretTokens)}`,
            ),
          );
          return;
        }

        resolve({ stderr, stdout });
      },
    );
  });
}

function summary(value) {
  return redactTokens(
    value
      .split(/\r?\n/)
      .filter((line) =>
        /Remote caching|cache miss|cache hit|Tasks:|Cached:|Time:|warning|error/i.test(line),
      )
      .join("\n"),
    secretTokens,
  );
}
