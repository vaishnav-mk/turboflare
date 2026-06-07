import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { requiredEnv } from "../shared/env.mjs";
import { redactTokens } from "../shared/redact.mjs";

const mode = process.argv.includes("--mode")
  ? process.argv[process.argv.indexOf("--mode") + 1]
  : "no-cache";
const outputDir = "ci-results";
const tasks = ["typecheck", "test", "test:integration", "build"];
const timeout = process.env.TURBO_REMOTE_CACHE_TIMEOUT ?? "20";
const secretTokens = [process.env.TURBO_TOKEN, process.env.INTERNAL_ADMIN_TOKEN];

await mkdir(outputDir, { recursive: true });

if (mode === "no-cache") {
  await clearTurboRuns();
  const result = await runTurbo("no-cache", "local:");
  await writeProfile({ mode: "no-cache", ...result });
  log("no-cache", result);
} else if (mode === "seed") {
  await clearTurboRuns();
  const result = await runTurbo("seed", "local:,remote:w", remoteEnv());
  await writeProfile({ mode: "seed", ...result });
  log("seed", result);
} else if (mode === "rebuild") {
  const internalToken = process.env.INTERNAL_ADMIN_TOKEN;
  try {
    await clearTurboRuns();
    const result = await runTurbo("rebuild", "local:,remote:r", remoteEnv());
    if (result.cacheHits === 0) {
      throw new Error(`expected cache hits on rebuild but got 0\n${result.stdoutTail}`);
    }
    await writeProfile({ mode: "rebuild", ...result });
    log("rebuild", result);
  } finally {
    if (internalToken) {
      await purge(requiredEnv("TURBO_API"), internalToken, requiredEnv("TURBO_TEAM")).catch((e) =>
        console.warn("purge failed:", e.message),
      );
    }
  }
} else {
  throw new Error(`unknown mode: ${mode}. use no-cache, seed, or rebuild`);
}

function remoteEnv() {
  return {
    TURBO_API: requiredEnv("TURBO_API"),
    TURBO_TOKEN: requiredEnv("TURBO_TOKEN"),
    TURBO_TEAM: requiredEnv("TURBO_TEAM"),
    TURBO_TELEMETRY_DISABLED: "1",
  };
}

function runTurbo(id, cacheMode, extraEnv = {}) {
  const args = [
    "turbo",
    "run",
    ...tasks,
    "--cache",
    cacheMode,
    "--remote-cache-timeout",
    timeout,
    "--output-logs=new-only",
    "--summarize",
  ];
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    console.log(`$ pnpm ${args.join(" ")}`);
    execFile(
      "pnpm",
      args,
      { env: { ...process.env, ...extraEnv } },
      async (error, stdout, stderr) => {
        const wallMs = Math.round(performance.now() - t0);
        const cacheHits = (stdout.match(/cache hit/gi) || []).length;
        const cacheMisses = (stdout.match(/cache miss/gi) || []).length;
        const cacheBypasses = (stdout.match(/cache bypass/gi) || []).length;
        const cached = parseInt((stdout.match(/(\d+) cached/i) || [])[1] || "0", 10);
        const stdoutTail = stdout.split("\n").filter(Boolean).slice(-15).join("\n");

        if (error) {
          reject(
            new Error(
              `${id} failed (${error.code})\n${redactTokens(stdoutTail, secretTokens)}\n${redactTokens(stderr.slice(-500), secretTokens)}`,
            ),
          );
          return;
        }

        const taskDetails = await parseSummary();

        resolve({
          id,
          wallMs,
          turboMs: taskDetails.turboMs,
          cacheHits,
          cacheMisses,
          cacheBypasses,
          cached,
          tasks: taskDetails.tasks,
          taskCount: taskDetails.tasks.length || tasks.length,
          stdoutTail,
        });
      },
    );
  });
}

async function clearTurboRuns() {
  const runsDir = join(process.cwd(), ".turbo", "runs");
  await rm(runsDir, { force: true, recursive: true }).catch(() => {});
}

async function parseSummary() {
  const runsDir = join(process.cwd(), ".turbo", "runs");
  let files;
  try {
    files = await readdir(runsDir);
  } catch {
    return { turboMs: 0, tasks: [] };
  }
  const jsonFiles = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  if (jsonFiles.length === 0) return { turboMs: 0, tasks: [] };

  const summaryPath = join(runsDir, jsonFiles[0]);
  const summaryText = await readFile(summaryPath, "utf8");
  const summary = JSON.parse(summaryText);
  const exec = summary.execution || {};
  const turboMs = exec.endTime && exec.startTime ? exec.endTime - exec.startTime : 0;

  const taskList = (summary.tasks || []).map((t) => {
    const dur =
      t.execution?.endTime && t.execution?.startTime
        ? t.execution.endTime - t.execution.startTime
        : 0;
    return {
      taskId: t.taskId,
      package: t.package,
      hash: t.hash?.slice(0, 8),
      durationMs: dur,
      cacheStatus: t.cache?.status || "UNKNOWN",
      cacheLocal: !!t.cache?.local,
      cacheRemote: !!t.cache?.remote,
      timeSaved: t.cache?.timeSaved || 0,
    };
  });

  return { turboMs, tasks: taskList };
}

async function purge(api, token, team) {
  const r = await fetch(`${api}/internal/teams/${encodeURIComponent(team)}/purge-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`purge ${r.status}`);
}

async function writeProfile(data) {
  await writeFile(`${outputDir}/profile.json`, JSON.stringify(data, null, 2) + "\n");
}

function log(label, r) {
  console.log(
    `${label}: wall=${fmt(r.wallMs)} turbo=${fmt(r.turboMs)} hits=${r.cacheHits} misses=${r.cacheMisses} bypasses=${r.cacheBypasses}`,
  );
  for (const t of r.tasks) {
    console.log(
      `  ${t.taskId}: ${fmt(t.durationMs)} [${t.cacheStatus}]${t.cacheRemote ? " remote" : ""}${t.timeSaved ? ` saved=${fmt(t.timeSaved)}` : ""}`,
    );
  }
}

function fmt(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}
