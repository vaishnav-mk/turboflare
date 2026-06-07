import { readFile, writeFile, mkdir } from "node:fs/promises";

const outputDir = "ci-results";
await mkdir(outputDir, { recursive: true });

const noCache = JSON.parse(await readFile("ci-results/no-cache/profile.json", "utf8"));
const remote = JSON.parse(await readFile("ci-results/remote/profile.json", "utf8"));

const coldMs = noCache.buildMs;
const warmMs = remote.buildMs;
const seedMs = remote.seedMs;
const savedMs = coldMs - warmMs;
const speedup = coldMs > 0 ? ((savedMs / coldMs) * 100) : 0;

const verdict = speedup > 10 ? "faster" : speedup > 0 ? "marginal" : "no improvement";

const md = `# CI Cache Comparison

| Metric | Value |
| --- | ---: |
| Cold build (no cache) | ${fmt(coldMs)} |
| Seed remote cache | ${fmt(seedMs)} |
| Warm rebuild (remote hits) | ${fmt(warmMs)} |
| **Time saved** | **${fmt(savedMs)}** |
| **Speedup** | **${speedup.toFixed(1)}%** |
| Cache hits on rebuild | ${remote.cacheHits} / ${remote.tasks} tasks |
| Cache misses on rebuild | ${remote.cacheMisses} |
| Verdict | **${verdict}** |

## How this works

1. **"without turborepo"** runs all CI tasks (\`typecheck\`, \`test\`, \`test:integration\`, \`build\`) with \`--cache=local:\` — zero caching, full cold build.
2. **"with turborepo"** first seeds the Turboflare remote cache (\`remote:w\`), then rebuilds from it (\`remote:r\` only, no local cache). The rebuild time is the "warm" number.
3. The speedup = \`(cold - warm) / cold * 100\`.

A real-world CI would keep the remote cache warm across runs, so subsequent PRs/merges hit the warm path automatically.
`;

await writeFile(`${outputDir}/comparison.md`, md);

if (process.env.GITHUB_STEP_SUMMARY) {
	await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
}

console.log(`cold: ${fmt(coldMs)}  warm: ${fmt(warmMs)}  saved: ${fmt(savedMs)}  speedup: ${speedup.toFixed(1)}%  verdict: ${verdict}`);

function fmt(ms) {
	if (ms < 0) return `-${fmt(-ms)}`;
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${(s % 60).toFixed(0)}s`;
}
