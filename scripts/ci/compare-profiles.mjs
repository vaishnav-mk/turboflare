import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const [withPath, withoutPath] = process.argv.slice(2);

if (withPath === undefined || withoutPath === undefined) {
	console.error("expected paths to with-turborepo and without-turborepo profile.json files");
	process.exit(1);
}

const withProfile = await readProfile(withPath);
const withoutProfile = await readProfile(withoutPath);
const markdown = comparisonMarkdown(withProfile, withoutProfile);
const outputPath = join("ci-results", "comparison", "comparison.md");
const withTotal = totalDuration(withProfile.steps);
const withoutTotal = totalDuration(withoutProfile.steps);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown);

if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
	await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
}

if (!withProfile.success || !withoutProfile.success) {
	process.exit(1);
}

if (withTotal >= withoutTotal) {
	process.exit(1);
}

function readProfile(path) {
	return readFile(path, "utf8").then((contents) => JSON.parse(contents));
}

function comparisonMarkdown(withProfile, withoutProfile) {
	const withSteps = byId(withProfile.steps);
	const withoutSteps = byId(withoutProfile.steps);
	const ids = [...new Set([...Object.keys(withSteps), ...Object.keys(withoutSteps)])];
	const totals = {
		withWarmup: totalDuration(withProfile.warmupSteps),
		withIncludingWarmup: totalDuration([...withProfile.warmupSteps, ...withProfile.steps]),
		with: totalDuration(withProfile.steps),
		withProfilerWall: profileWallDuration(withProfile),
		without: totalDuration(withoutProfile.steps),
		withoutProfilerWall: profileWallDuration(withoutProfile),
	};
	const profilerOverhead = {
		with: totals.withProfilerWall === undefined ? undefined : totals.withProfilerWall - totals.withIncludingWarmup,
		without: totals.withoutProfilerWall === undefined ? undefined : totals.withoutProfilerWall - totals.without,
	};
	const lines = [
		"# ci comparison",
		"",
		"This compares the measured warm Turborepo profile against equivalent direct commands. The GitHub job duration also includes checkout, setup-node, pnpm install, artifact upload/download, and the explicit Turborepo warmup step.",
		"",
		`with turborepo: ${withProfile.success ? "pass" : "fail"}`,
		`without turborepo: ${withoutProfile.success ? "pass" : "fail"}`,
		`fastest profile: ${totals.with < totals.without ? "with turborepo" : "without turborepo"}`,
		`with turborepo including warmup: ${formatDuration(totals.withIncludingWarmup)}`,
		"",
		"## measured job-step breakdown",
		"",
		"This table explains why the GitHub job boxes are both around two minutes while the warm Turborepo profile is much faster.",
		"",
		"| bucket | with turborepo | without turborepo | notes |",
		"| --- | ---: | ---: | --- |",
		`| explicit cache warmup inside profiler | ${formatDuration(totals.withWarmup)} | ${formatDuration(0)} | one-time cost to populate local Turborepo cache before measuring warm hits |`,
		`| measured verification profile | ${formatDuration(totals.with)} | ${formatDuration(totals.without)} | the apples-to-apples table below |`,
		`| profiler script overhead | ${durationOrMissing(profilerOverhead.with)} | ${durationOrMissing(profilerOverhead.without)} | process orchestration overhead inside \`profile.mjs\` |`,
		`| measured total inside profiler | ${durationOrMissing(totals.withProfilerWall)} | ${durationOrMissing(totals.withoutProfilerWall)} | excludes checkout, setup-node, pnpm install, and artifact upload/download |`,
		"| GitHub setup/install/artifact overhead | not measured here | not measured here | visible in the workflow step timings above the summary |",
		"",
		"## warm profile comparison",
		"",
		"| step | with turborepo | without turborepo | delta | % diff | faster |",
		"| --- | ---: | ---: | ---: | ---: | --- |",
	];

	for (const id of ids) {
		const withStep = withSteps[id];
		const withoutStep = withoutSteps[id];
		const delta = withStep !== undefined && withoutStep !== undefined ? withStep.durationMs - withoutStep.durationMs : undefined;
		lines.push(
			`| ${withStep?.label ?? withoutStep?.label ?? id} | ${stepCell(withStep)} | ${stepCell(withoutStep)} | ${deltaCell(delta)} | ${percentCell(delta, withoutStep?.durationMs)} | ${winnerCell(delta)} |`
		);
	}
	lines.push(
		`| **total** | **${formatDuration(totals.with)}** | **${formatDuration(totals.without)}** | **${formatSignedDuration(totals.with - totals.without)}** | **${percentCell(totals.with - totals.without, totals.without)}** | **${winnerCell(totals.with - totals.without)}** |`
	);

	lines.push("", "## command diffs", "");

	for (const id of ids) {
		const withStep = withSteps[id];
		const withoutStep = withoutSteps[id];
		lines.push(`### ${withStep?.label ?? withoutStep?.label ?? id}`, "", "```diff", `- ${withStep?.command ?? "missing"}`, `+ ${withoutStep?.command ?? "missing"}`, "```", "");
	}

	lines.push("## stdout tails", "");

	for (const id of ids) {
		const withStep = withSteps[id];
		const withoutStep = withoutSteps[id];
		lines.push(`### ${withStep?.label ?? withoutStep?.label ?? id}`, "", "with turborepo", "", "```txt", withStep?.stdoutTail ?? "missing", "```", "");
		lines.push("without turborepo", "", "```txt", withoutStep?.stdoutTail ?? "missing", "```", "");
	}

	lines.push("## stderr tails", "");

	for (const id of ids) {
		const withStep = withSteps[id];
		const withoutStep = withoutSteps[id];
		lines.push(`### ${withStep?.label ?? withoutStep?.label ?? id}`, "", "with turborepo", "", "```txt", withStep?.stderrTail ?? "missing", "```", "");
		lines.push("without turborepo", "", "```txt", withoutStep?.stderrTail ?? "missing", "```", "");
	}

	return `${lines.join("\n")}\n`;
}

function byId(steps) {
	return Object.fromEntries(steps.map((step) => [step.id, step]));
}

function stepCell(step) {
	if (step === undefined) {
		return "missing";
	}

	return `${step.exitCode === 0 ? "pass" : "fail"} ${formatDuration(step.durationMs)}`;
}

function deltaCell(delta) {
	return delta === undefined ? "missing" : formatSignedDuration(delta);
}

function percentCell(delta, baseline) {
	if (delta === undefined || baseline === undefined || baseline === 0) {
		return "missing";
	}

	const percent = (delta / baseline) * 100;
	const sign = percent > 0 ? "+" : "";
	return `${sign}${percent.toFixed(1)}%`;
}

function winnerCell(delta) {
	if (delta === undefined || delta === 0) {
		return "tie";
	}

	return delta < 0 ? "with turborepo" : "without turborepo";
}

function formatDuration(durationMs) {
	return `${(durationMs / 1000).toFixed(2)}s`;
}

function durationOrMissing(durationMs) {
	return durationMs === undefined ? "missing" : formatDuration(durationMs);
}

function formatSignedDuration(durationMs) {
	const sign = durationMs > 0 ? "+" : "";
	return `${sign}${formatDuration(durationMs)}`;
}

function totalDuration(steps) {
	return steps.reduce((total, step) => total + step.durationMs, 0);
}

function profileWallDuration(profile) {
	const started = Date.parse(profile.startedAt);
	const ended = Date.parse(profile.endedAt);
	return Number.isFinite(started) && Number.isFinite(ended) ? ended - started : undefined;
}
