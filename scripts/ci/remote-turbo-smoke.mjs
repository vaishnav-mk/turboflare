import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, "fixtures", "complex-turbo-monorepo");
const TURBO_BIN = join(REPO_ROOT, "node_modules", ".bin", "turbo");
const GENERATED_DIRECTORIES = new Set([".next", ".turbo", "dist", "node_modules"]);

const turboApi = requiredEnv("TURBO_API");
const turboToken = requiredEnv("TURBO_TOKEN");
const turboTeam = process.env.TURBO_TEAM ?? `remote-ci-${Date.now()}`;
const internalAdminToken = process.env.INTERNAL_ADMIN_TOKEN;

const fixture = await mkdtemp(join(tmpdir(), "turboflare-remote-ci-"));

try {
	await cp(FIXTURE_ROOT, fixture, { recursive: true });
	await run("pnpm", ["install", "--frozen-lockfile"], fixture);
	await run("git", ["init"], fixture);
	await run("git", ["add", "."], fixture);
	await run("git", ["-c", "user.email=turboflare@example.com", "-c", "user.name=turboflare", "commit", "-m", "init"], fixture);

	const first = await runTurbo(fixture, turboApi, turboToken, turboTeam);
	if (!/cache miss/i.test(first.stdout)) {
		throw new Error(`expected first run to miss remote cache\n${first.stdout}`);
	}

	await removeGeneratedDirectories(fixture);

	const second = await runTurbo(fixture, turboApi, turboToken, turboTeam);
	if (!/cache hit/i.test(second.stdout)) {
		throw new Error(`expected second run to hit remote cache\n${second.stdout}`);
	}

	console.log(JSON.stringify({ ok: true, team: turboTeam }, null, 2));
} finally {
	if (internalAdminToken !== undefined) {
		await purgeTeam(turboApi, internalAdminToken, turboTeam).catch((error) => console.warn(error.message));
	}

	await rm(fixture, { force: true, recursive: true });
}

async function runTurbo(cwd, api, token, team) {
	return run(TURBO_BIN, ["run", "build", "--filter=@fixture/math", "--output-logs=full", "--remote-cache-timeout", "20"], cwd, {
		FORCE_COLOR: "0",
		NO_COLOR: "1",
		TURBO_API: api,
		TURBO_CACHE: "remote:rw",
		TURBO_TEAM: team,
		TURBO_TELEMETRY_DISABLED: "1",
		TURBO_TOKEN: token,
	});
}

function run(command, args, cwd, env = {}) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		execFile(command, args, { cwd, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
			const durationMs = Date.now() - start;
			const result = { durationMs, stderr, stdout };
			console.log(JSON.stringify({ command, args, durationMs, cwd, stderr: redact(stderr), stdout: redact(summary(stdout)) }, null, 2));

			if (error !== null) {
				reject(new Error(`${error.message}\n${redact(stdout)}\n${redact(stderr)}`));
				return;
			}

			resolve(result);
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

			if (GENERATED_DIRECTORIES.has(entry.name)) {
				await rm(path, { force: true, recursive: true });
				return;
			}

			await removeGeneratedDirectories(path);
		})
	);
}

async function purgeTeam(api, token, team) {
	const response = await fetch(`${api}/internal/teams/${encodeURIComponent(team)}/purge-all`, {
		headers: { Authorization: `Bearer ${token}` },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`failed to purge remote smoke team: ${response.status} ${await response.text()}`);
	}
}

function requiredEnv(name) {
	const value = process.env[name];
	if (value === undefined || value.length === 0) {
		throw new Error(`${name} is required`);
	}

	return value;
}

function summary(value) {
	return value
		.split(/\r?\n/)
		.filter((line) => /Remote caching|cache miss|cache hit|Tasks:|Cached:|Time:|ok|warning/i.test(line))
		.join("\n");
}

function redact(value) {
	const withoutTurboToken = value.replaceAll(turboToken, "<redacted>");
	return internalAdminToken === undefined ? withoutTurboToken : withoutTurboToken.replaceAll(internalAdminToken, "<redacted>");
}
