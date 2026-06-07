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
	await writeProfile({
		mode: "no-cache",
		buildMs: result.durationMs,
		cacheHits: result.cacheHits,
		cacheMisses: result.cacheMisses,
		cacheBypasses: result.cacheBypasses,
		cached: result.cached,
		tasks: tasks.length,
	});
	console.log(`no-cache build: ${fmt(result.durationMs)} (${result.cacheBypasses} bypasses)`);
} else if (mode === "seed") {
	const turboEnv = remoteEnv();
	const result = await runTurbo("seed", "local:,remote:w", turboEnv);
	await writeProfile({
		mode: "seed",
		buildMs: result.durationMs,
		cacheHits: result.cacheHits,
		cacheMisses: result.cacheMisses,
		cached: result.cached,
		tasks: tasks.length,
	});
	console.log(`seed: ${fmt(result.durationMs)} (${result.cacheMisses} misses, uploaded to remote)`);
} else if (mode === "rebuild") {
	const turboEnv = remoteEnv();
	const internalToken = process.env.INTERNAL_ADMIN_TOKEN;
	try {
		const result = await runTurbo("rebuild", "local:,remote:r", turboEnv);
		if (result.cacheHits === 0) {
			throw new Error(`expected cache hits on rebuild but got 0\n${result.stdoutTail}`);
		}
		await writeProfile({
			mode: "rebuild",
			buildMs: result.durationMs,
			cacheHits: result.cacheHits,
			cacheMisses: result.cacheMisses,
			cached: result.cached,
			tasks: tasks.length,
		});
		console.log(`rebuild: ${fmt(result.durationMs)} (${result.cacheHits} hits, ${result.cacheMisses} misses)`);
	} finally {
		if (internalToken) {
			const api = env("TURBO_API");
			const team = env("TURBO_TEAM");
			await purge(api, internalToken, team).catch((e) => console.warn("purge failed:", e.message));
		}
	}
} else {
	throw new Error(`unknown mode: ${mode}. use no-cache, seed, or rebuild`);
}

function remoteEnv() {
	return {
		TURBO_API: env("TURBO_API"),
		TURBO_TOKEN: env("TURBO_TOKEN"),
		TURBO_TEAM: env("TURBO_TEAM"),
		TURBO_TELEMETRY_DISABLED: "1",
	};
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
			const cached = parseInt((stdout.match(/(\d+) cached/i) || [])[1] || "0", 10);
			const stdoutTail = stdout.split("\n").filter(Boolean).slice(-15).join("\n");
			if (error) {
				reject(new Error(`${id} failed (${error.code})\n${stdoutTail}\n${stderr.slice(-500)}`));
				return;
			}
			resolve({ id, durationMs, cacheHits, cacheMisses, cacheBypasses, cached, stdoutTail });
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

async function writeProfile(data) {
	await writeFile(`${outputDir}/profile.json`, JSON.stringify(data, null, 2) + "\n");
}

function env(k) {
	const v = process.env[k];
	if (!v) throw new Error(`${k} required`);
	return v;
}

function fmt(ms) {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}
