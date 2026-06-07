import { readFile, writeFile, mkdir } from "node:fs/promises";

const outputDir = "ci-results";
await mkdir(outputDir, { recursive: true });

const noCacheText = await readFile("ci-results/no-cache/profile.json", "utf8");
const seedText = await readFile("ci-results/seed/profile.json", "utf8");
const rebuildText = await readFile("ci-results/rebuild/profile.json", "utf8");
const noCache = JSON.parse(noCacheText);
const seed = JSON.parse(seedText);
const rebuild = JSON.parse(rebuildText);

const coldWall = noCache.wallMs;
const seedWall = seed.wallMs;
const rebuildWall = rebuild.wallMs;
const savedMs = coldWall - rebuildWall;
const speedup = coldWall > 0 ? (savedMs / coldWall) * 100 : 0;

const verdict =
  speedup > 10
    ? "faster"
    : speedup > 0
      ? "marginal"
      : speedup < -5
        ? "regression"
        : "no improvement";

const bar = (ms, max) => {
  const width = Math.max(1, Math.round((ms / max) * 30));
  return "`" + "█".repeat(width) + "░".repeat(30 - width) + "`";
};
const maxMs = Math.max(coldWall, seedWall, rebuildWall);

const md = `# Turboflare CI Cache Benchmark

## Overview

| | Time | Bar |
| --- | ---: | --- |
| Cold build (no cache) | ${fmt(coldWall)} | ${bar(coldWall, maxMs)} |
| Seed remote cache | ${fmt(seedWall)} | ${bar(seedWall, maxMs)} |
| **Rebuild (remote hits)** | **${fmt(rebuildWall)}** | ${bar(rebuildWall, maxMs)} |

## Summary

| Metric | Value |
| --- | ---: |
| **Time saved** | **${fmt(savedMs)}** |
| **Speedup** | **${speedup.toFixed(1)}%** |
| Tasks cached on rebuild | ${rebuild.cached} / ${rebuild.taskCount} |
| Verdict | **${verdict}** |

## Per-task breakdown: Cold build (no cache)

| Task | Duration | Cache |
| --- | ---: | --- |
${taskRows(noCache.tasks)}
| **Total (turbo)** | **${fmt(noCache.turboMs)}** | — |
| **Total (wall)** | **${fmt(noCache.wallMs)}** | — |

## Per-task breakdown: Seed (cold + upload)

| Task | Duration | Cache |
| --- | ---: | --- |
${taskRows(seed.tasks)}
| **Total (turbo)** | **${fmt(seed.turboMs)}** | — |
| **Total (wall)** | **${fmt(seed.wallMs)}** | — |

## Per-task breakdown: Rebuild (remote cache)

| Task | Duration | Cache | Time saved |
| --- | ---: | --- | ---: |
${taskRows(rebuild.tasks, true)}
| **Total (turbo)** | **${fmt(rebuild.turboMs)}** | — | — |
| **Total (wall)** | **${fmt(rebuildWall)}** | — | — |

## How this works

1. **Cold build** — all CI tasks with \`--cache=local:\`. Zero caching.
2. **Seed** — same tasks, writes to Turboflare (\`remote:w\`). First-run cost.
3. **Rebuild** — separate runner, empty local cache, reads only from Turboflare (\`remote:r\`). Simulates a subsequent CI run.
4. **Speedup** = (cold wall − rebuild wall) / cold wall × 100
`;

await writeFile(`${outputDir}/comparison.md`, md);

if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
}

console.log(
  `cold: ${fmt(coldWall)}  seed: ${fmt(seedWall)}  warm: ${fmt(rebuildWall)}  saved: ${fmt(savedMs)}  speedup: ${speedup.toFixed(1)}%`,
);

function taskRows(tasks, showSaved = false) {
  if (!tasks || tasks.length === 0) return "| (no task data) | | |\n";
  return tasks
    .map((t) => {
      const status = t.cacheRemote ? `${t.cacheStatus} (remote)` : t.cacheStatus;
      const saved = showSaved && t.timeSaved ? fmt(t.timeSaved) : "";
      return showSaved
        ? `| \`${t.taskId}\` | ${fmt(t.durationMs)} | ${status} | ${saved} |`
        : `| \`${t.taskId}\` | ${fmt(t.durationMs)} | ${status} |`;
    })
    .join("\n");
}

function fmt(ms) {
  if (ms < 0) return `-${fmt(-ms)}`;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(0)}s`;
}
