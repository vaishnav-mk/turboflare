import { readFile, writeFile, mkdir } from "node:fs/promises";

const outputDir = "ci-results";
await mkdir(outputDir, { recursive: true });

const noCache = JSON.parse(await readFile("ci-results/no-cache/profile.json", "utf8"));
const seed = JSON.parse(await readFile("ci-results/seed/profile.json", "utf8"));
const rebuild = JSON.parse(await readFile("ci-results/rebuild/profile.json", "utf8"));

const coldMs = noCache.buildMs;
const seedMs = seed.buildMs;
const warmMs = rebuild.buildMs;
const savedMs = coldMs - warmMs;
const speedup = coldMs > 0 ? ((savedMs / coldMs) * 100) : 0;

const verdict = speedup > 10 ? "faster" : speedup > 0 ? "marginal" : "no improvement";

const md = `# CI Cache Comparison

## Results

| Step | Time | Cache hits | Cache misses |
| --- | ---: | ---: | ---: |
| Cold build (no cache) | ${fmt(coldMs)} | ${noCache.cacheHits} | ${noCache.cacheBypasses ?? noCache.cacheMisses} bypasses |
| Seed remote cache | ${fmt(seedMs)} | ${seed.cacheHits} | ${seed.cacheMisses} misses |
| **Rebuild from remote** | **${fmt(warmMs)}** | **${rebuild.cacheHits}** | **${rebuild.cacheMisses}** |

## Summary

| Metric | Value |
| --- | ---: |
| **Time saved** | **${fmt(savedMs)}** |
| **Speedup** | **${speedup.toFixed(1)}%** |
| Tasks cached on rebuild | ${rebuild.cached} / ${rebuild.tasks} |
| Verdict | **${verdict}** |

## How this works

1. **without turborepo** — runs all CI tasks (\`typecheck\`, \`test\`, \`test:integration\`, \`build\`) with \`--cache=local:\`. Zero caching. Full cold build every time.
2. **with turborepo (seed)** — same tasks, but writes artifacts to Turboflare remote cache (\`remote:w\`). This is the first-run cost.
3. **with turborepo (rebuild)** — runs on a separate runner with empty local cache, reads only from remote (\`remote:r\`). This simulates a subsequent CI run after the cache is warm.
4. **Speedup** = \`(cold - rebuild) / cold × 100\`

In real-world usage, step 2 happens once (or when code changes), and every subsequent CI run gets step 3 speeds.
`;

await writeFile(`${outputDir}/comparison.md`, md);

if (process.env.GITHUB_STEP_SUMMARY) {
	await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
}

console.log(`cold: ${fmt(coldMs)}  seed: ${fmt(seedMs)}  warm: ${fmt(warmMs)}  saved: ${fmt(savedMs)}  speedup: ${speedup.toFixed(1)}%  verdict: ${verdict}`);

function fmt(ms) {
	if (ms < 0) return `-${fmt(-ms)}`;
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${(s % 60).toFixed(0)}s`;
}
