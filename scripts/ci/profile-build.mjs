import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "no-cache";
const outputDir = "ci-results";
const tasks = ["typecheck", "test", "test:integration", "build"];
const timeout = process.env.TURBO_REMOTE_CACHE_TIMEOUT ?? "20";

await mkdir(outputDir, { recursive: true });

if (mode === "no-cache") {
	const result = await runTurbo("no-cache", "local:");
	await writeFile(`${outputDir}/profile.json`, JSON.stringify({
		mode: "no-cache",
		buildMs: result.durationMs,
		cacheHits: result.cacheHits,
		cacheMisses: result.cacheMisses,
		cacheBypasses: result.cacheBypasses,
		cached: result.cached,
		tasks: tasks.length,
	}, null, 2) + "\n");
	console.log(`no-cache build: ${fmt(result.durationMs)} (${result.cacheMisses} misses, ${result.cacheHits} hits, ${result.cacheBypasses} bypasses)`);
} else if (mode === "remote") {
	const turboApi = env("TURBO_API");
	const turboToken = env("TURBO_TOKEN");
	const turboTeam = env("TURBO_TEAM");
	const internalToken = process.env.INTERNAL_ADMIN_TOKEN;
	const turboEnv = { TURBO_API: turboApi, TURBO_TOKEN: turboToken, TURBO_TEAM: turboTeam, TURBO_TELEMETRY_DISABLED: "1" };

	try {
		console.log("--- phase 1: seed remote cache ---");
		const seed = await runTurbo("seed", "local:,remote:w", turboEnv);
		console.log(`seed: ${fmt(seed.durationMs)} (${seed.cacheMisses} misses)`);

		console.log("--- phase 2: rebuild from remote ---");
		const rebuild = await runTurbo("rebuild", "local:,remote:r", turboEnv);
		console.log(`rebuild: ${fmt(rebuild.durationMs)} (${rebuild.cacheHits} hits, ${rebuild.cacheMisses} misses)`);

		if (rebuild.cacheHits === 0) {
			throw new Error(`expected cache hits on rebuild but got 0\nstdout: ${rebuild.stdoutTail}`);
		}

		await writeFile(`${outputDir}/profile.json`, JSON.stringify({
			mode: "remote",
			seedMs: seed.durationMs,
			buildMs: rebuild.durationMs,
			cacheHits: rebuild.cacheHits,
			cacheMisses: rebuild.cacheMisses,
			cached: rebuild.cached,
			tasks: tasks.length,
		}, null, 2) + "\n");
	} finally {
		if (internalToken) {
			await purge(turboApi, internalToken, turboTeam).catch((e) => console.warn("purge failed:", e.message));
		}
	}
} else {
	throw new Error(`unknown mode: ${mode}`);
}

function runTurbo(id, cacheMode, extraEnv = {}) {
	const args = ["turbo", "run", ...tasks, "--cache", cacheMode, "--remote-cache-timeout", timeout, "--output-logs=new-only"];
	return new Promise((resolve, reject) => {
		const t0 = performance.now();
		console.log(`$ pnpm ${args.join(" ")}`);
		execFile("pnpm", args, { env: { ...process.env, ...extraEnv } }, (error, stdout, stderr) => {
			const durationMs = Math.round(performance.now() - t0);
			const cacheHits = (stdout.match(/cache hit/gi) || []).length;
			const cacheMisses = (stdout.match(/cache miss/gi) || []).length;
			const cacheBypasses = (stdout.match(/cache bypass/gi) || []).length;
			const cached = (stdout.match(/(\d+) cached/i) || [])[1] || "0";
			const stdoutTail = stdout.split("\n").filter(Boolean).slice(-15).join("\n");
			if (error) {
				reject(new Error(`${id} failed (${error.code})\n${stdoutTail}\n${stderr.slice(-500)}`));
				return;
			}
			resolve({ id, durationMs, cacheHits, cacheMisses, cacheBypasses, cached: parseInt(cached, 10), stdoutTail });
		});
	});
}

async function purge(api, token, team) {
	const r = await fetch(`${api}/internal/teams/${encodeURIComponent(team)}/purge-all`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!r.ok) throw new Error(`purge ${r.status}`);
}

function env(k) {
	const v = process.env[k];
	if (!v) throw new Error(`${k} required`);
	return v;
}

function fmt(ms) {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}
