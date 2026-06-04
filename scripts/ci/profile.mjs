import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const profiles = {
	"with-turborepo": [
		{ id: "typecheck", label: "typecheck", command: "pnpm typecheck" },
		{ id: "unit", label: "worker tests", command: "pnpm test" },
		{ id: "integration", label: "real turbo integration", command: "pnpm test:integration" },
		{ id: "build", label: "wrangler dry-run build", command: "pnpm build" },
	],
	"without-turborepo": [
		{
			id: "typecheck",
			label: "typecheck",
			command:
				"pnpm --filter @turboflare/protocol typecheck && pnpm --filter @turboflare/shared typecheck && pnpm --filter @turboflare/cache-worker typecheck",
		},
		{ id: "unit", label: "worker tests", command: "pnpm --filter @turboflare/cache-worker test" },
		{ id: "integration", label: "real turbo integration", command: "pnpm --filter @turboflare/cache-worker test:integration" },
		{
			id: "build",
			label: "wrangler dry-run build",
			command:
				"pnpm --filter @turboflare/protocol build && pnpm --filter @turboflare/shared build && pnpm --filter @turboflare/cache-worker build",
		},
	],
};

const warmups = {
	"with-turborepo": [{ id: "warmup", label: "warm turborepo cache", command: "pnpm typecheck && pnpm test && pnpm test:integration && pnpm build" }],
	"without-turborepo": [],
};

const profileName = process.argv[2];
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

if (!isProfileName(profileName)) {
	console.error(`expected profile name: ${Object.keys(profiles).join(", ")}`);
	process.exit(1);
}

const outputDirectory = join("ci-results", profileName);
await mkdir(outputDirectory, { recursive: true });

const startedAt = new Date().toISOString();
const warmupSteps = [];
const steps = [];

for (const step of warmups[profileName]) {
	const result = await runStep(step, outputDirectory);
	warmupSteps.push(result);
}

for (const step of profiles[profileName]) {
	const result = await runStep(step, outputDirectory);
	steps.push(result);
}

const profile = {
	endedAt: new Date().toISOString(),
	name: profileName,
	startedAt,
	steps,
	success: [...warmupSteps, ...steps].every((step) => step.exitCode === 0),
	warmupSteps,
};

await writeFile(join(outputDirectory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
await writeFile(join(outputDirectory, "profile.md"), profileMarkdown(profile));

if (!profile.success) {
	process.exit(1);
}

function isProfileName(value) {
	return typeof value === "string" && Object.hasOwn(profiles, value);
}

function runStep(step, outputDirectory) {
	return new Promise((resolve) => {
		const startedAt = new Date().toISOString();
		const started = performance.now();
		let stdout = "";
		let stderr = "";

		console.log(`running ${step.id}: ${step.command}`);

		const child = spawn(step.command, {
			env: process.env,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		child.stdout.on("data", (chunk) => {
			const text = chunk.toString();
			stdout += text;
			process.stdout.write(text);
		});

		child.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			stderr += text;
			process.stderr.write(text);
		});

		child.on("close", async (exitCode) => {
			const durationMs = Math.round(performance.now() - started);
			const endedAt = new Date().toISOString();

			await writeFile(join(outputDirectory, `${step.id}.stdout.log`), stdout);
			await writeFile(join(outputDirectory, `${step.id}.stderr.log`), stderr);

			resolve({
				command: step.command,
				durationMs,
				endedAt,
				exitCode,
				id: step.id,
				label: step.label,
				startedAt,
				stderrTail: tail(stderr),
				stdoutTail: tail(stdout),
			});
		});
	});
}

function profileMarkdown(profile) {
	const lines = [`# ${profile.name}`, "", `status: ${profile.success ? "pass" : "fail"}`, "", "| step | status | duration |", "| --- | --- | --- |"];

	for (const step of profile.warmupSteps) {
		lines.push(`| ${step.label} | ${step.exitCode === 0 ? "pass" : "fail"} | ${formatDuration(step.durationMs)} |`);
	}

	for (const step of profile.steps) {
		lines.push(`| ${step.label} | ${step.exitCode === 0 ? "pass" : "fail"} | ${formatDuration(step.durationMs)} |`);
	}

	lines.push("");
	return `${lines.join("\n")}\n`;
}

function tail(text) {
	return stripAnsi(text).split("\n").filter(Boolean).slice(-20).join("\n");
}

function stripAnsi(text) {
	return text.replace(ANSI_PATTERN, "");
}

function formatDuration(durationMs) {
	return `${(durationMs / 1000).toFixed(2)}s`;
}
