import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { requiredEnv } from "../shared/env.mjs";
import { redactTokens } from "../shared/redact.mjs";

const outputDirectory = join("ci-results", "dogfood-remote-cache");
const turboApi = requiredEnv("TURBO_API");
const turboToken = requiredEnv("TURBO_TOKEN");
const turboTeam = requiredEnv("TURBO_TEAM");
const internalAdminToken = process.env.INTERNAL_ADMIN_TOKEN;
const secretTokens = [turboToken, internalAdminToken];
const timeout = process.env.TURBO_REMOTE_CACHE_TIMEOUT ?? "20";
const tasks = ["typecheck", "test", "test:integration", "build"];

await mkdir(outputDirectory, { recursive: true });

const phases = [];
try {
  const writePhase = await runTurboPhase("remote-write", "local:,remote:w");
  phases.push(writePhase);
  const readPhase = await runTurboPhase("remote-read", "local:,remote:r");
  phases.push(readPhase);

  const write = phases[0];
  const read = phases[1];
  if (!/cache (?:miss|bypass)/i.test(write.stdout)) {
    throw new Error(`expected write phase to execute tasks\n${write.stdout}`);
  }
  if (!/cache hit/i.test(read.stdout) || /cache (?:miss|bypass)/i.test(read.stdout)) {
    throw new Error(`expected read phase to restore only remote cache hits\n${read.stdout}`);
  }
} finally {
  if (internalAdminToken !== undefined) {
    await purgeTeam().catch((error) => console.warn(error.message));
  }
}

const result = {
  phases: phases.map(({ stderr: _stderr, stdout: _stdout, ...phase }) => phase),
  team: turboTeam,
  success: true,
};
const markdown = markdownSummary(phases);
await writeFile(join(outputDirectory, "dogfood.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(join(outputDirectory, "dogfood.md"), markdown);

if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
}

function runTurboPhase(id, cacheMode) {
  const args = [
    "turbo",
    "run",
    ...tasks,
    "--cache",
    cacheMode,
    "--remote-cache-timeout",
    timeout,
    "--output-logs=full",
  ];
  return run(id, "pnpm", args, {
    TURBO_API: turboApi,
    TURBO_CACHE: cacheMode,
    TURBO_TEAM: turboTeam,
    TURBO_TELEMETRY_DISABLED: "1",
    TURBO_TOKEN: turboToken,
  });
}

function run(id, command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    console.log(`${command} ${args.join(" ")}`);

    execFile(command, args, { env: { ...process.env, ...env } }, async (error, stdout, stderr) => {
      const durationMs = Math.round(performance.now() - started);
      const endedAt = new Date().toISOString();
      const phase = {
        cacheHits: countMatches(stdout, /cache hit/gi),
        cacheMisses: countMatches(stdout, /cache miss/gi),
        cacheBypasses: countMatches(stdout, /cache bypass/gi),
        command: `${command} ${args.join(" ")}`,
        durationMs,
        endedAt,
        exitCode: error?.code ?? 0,
        id,
        stderr,
        stdout,
        stderrTail: tail(stderr),
        stdoutTail: tail(stdout),
        startedAt,
      };

      await writeFile(
        join(outputDirectory, `${id}.stdout.log`),
        redactTokens(stdout, secretTokens),
      );
      await writeFile(
        join(outputDirectory, `${id}.stderr.log`),
        redactTokens(stderr, secretTokens),
      );

      if (error !== null) {
        reject(
          new Error(
            `${error.message}\n${redactTokens(stdout, secretTokens)}\n${redactTokens(stderr, secretTokens)}`,
          ),
        );
        return;
      }

      resolve(phase);
    });
  });
}

async function purgeTeam() {
  const response = await fetch(
    `${turboApi}/internal/teams/${encodeURIComponent(turboTeam)}/purge-all`,
    {
      headers: { Authorization: `Bearer ${internalAdminToken}` },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(`failed to purge dogfood team: ${response.status} ${await response.text()}`);
  }
}

function markdownSummary(phases) {
  const lines = [
    "# dogfood remote cache",
    "",
    `team: ${turboTeam}`,
    "",
    "| phase | status | duration | hits | misses | bypasses |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const phase of phases) {
    lines.push(
      `| ${phase.id} | ${phase.exitCode === 0 ? "pass" : "fail"} | ${formatDuration(phase.durationMs)} | ${phase.cacheHits} | ${phase.cacheMisses} | ${phase.cacheBypasses} |`,
    );
  }

  lines.push(
    "",
    "The first phase writes this repo's own CI tasks to Turboflare using `remote:w`. The second phase reads with `remote:r` and must restore remote cache hits.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}

function tail(text) {
  return redactTokens(
    stripAnsi(text).split("\n").filter(Boolean).slice(-20).join("\n"),
    secretTokens,
  );
}

function stripAnsi(text) {
  let output = "";
  let skippingAnsi = false;
  for (const character of text) {
    if (character.charCodeAt(0) === 27) {
      skippingAnsi = true;
      continue;
    }
    if (skippingAnsi) {
      if (character === "m") {
        skippingAnsi = false;
      }
      continue;
    }
    output += character;
  }
  return output;
}

function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}
