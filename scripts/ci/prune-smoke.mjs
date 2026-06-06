import { execFile } from "node:child_process";
import { copyFile, cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const target = process.argv[2];
const task = process.argv[3] ?? "build";
if (target === undefined) {
	throw new Error("usage: node scripts/ci/prune-smoke.mjs <target-package> [task]");
}

if (process.env.TURBO_API === undefined || process.env.TURBO_TOKEN === undefined || process.env.TURBO_TEAM === undefined) {
	throw new Error("TURBO_API, TURBO_TOKEN, and TURBO_TEAM are required");
}

const cwd = resolve(process.env.PRUNE_CWD ?? process.cwd());
const turboBin = resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "turbo.cmd" : "turbo");
const outDir = await mkdtemp(join(tmpdir(), "turboflare-prune-"));
const fullDir = join(outDir, "full");
const generatedDirectories = new Set([".next", ".turbo", "dist"]);

try {
	await run(turboBin, ["prune", target, "--docker", "--out-dir", outDir], cwd);
	await copyFile(join(outDir, "pnpm-lock.yaml"), join(fullDir, "pnpm-lock.yaml"));
	await run("pnpm", ["install", "--frozen-lockfile"], fullDir);
	await run("git", ["init"], fullDir);
	await run("git", ["add", "."], fullDir);
	await run("git", ["-c", "user.email=turboflare@example.com", "-c", "user.name=turboflare", "commit", "-m", "init"], fullDir);

	const first = await run(turboBin, ["run", task, "--filter", `${target}...`, "--cache=local:,remote:w", "--remote-cache-timeout", "20", "--output-logs=full"], fullDir);
	if (!/cache (?:miss|bypass)/i.test(first.stdout)) {
		throw new Error(`expected pruned first run to execute\n${first.stdout}`);
	}

	await removeGeneratedDirectories(fullDir);

	const second = await run(turboBin, ["run", task, "--filter", `${target}...`, "--cache=local:,remote:r", "--remote-cache-timeout", "20", "--output-logs=full"], fullDir);
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
		execFile(command, args, { cwd, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TURBO_TELEMETRY_DISABLED: "1" } }, (error, stdout, stderr) => {
			const durationMs = Date.now() - started;
			console.log(JSON.stringify({ command, args, durationMs, cwd, stdout: summary(stdout), stderr: summary(stderr) }, null, 2));
			if (error !== null) {
				reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
				return;
			}

			resolve({ stderr, stdout });
		});
	});
}

async function removeGeneratedDirectories(root) {
	const entries = await readdir(root, { withFileTypes: true });
	await Promise.all(
		entries.map(async (entry) => {
			const path = join(root, entry.name);
			if (!entry.isDirectory()) {
				return;
			}

			if (generatedDirectories.has(entry.name)) {
				await rm(path, { force: true, recursive: true });
				return;
			}

			await removeGeneratedDirectories(path);
		})
	);
}

function summary(value) {
	return value
		.split(/\r?\n/)
		.filter((line) => /Remote caching|cache miss|cache hit|Tasks:|Cached:|Time:|warning|error/i.test(line))
		.join("\n");
}
