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
		withIncludingWarmup: totalDuration([...withProfile.warmupSteps, ...withProfile.steps]),
		with: totalDuration(withProfile.steps),
		without: totalDuration(withoutProfile.steps),
	};
	const lines = [
		"# ci comparison",
		"",
		"This compares the measured warm Turborepo profile against equivalent direct commands. The GitHub job duration also includes checkout, install, and the explicit Turborepo warmup step.",
		"",
		`with turborepo: ${withProfile.success ? "pass" : "fail"}`,
		`without turborepo: ${withoutProfile.success ? "pass" : "fail"}`,
		`fastest profile: ${totals.with < totals.without ? "with turborepo" : "without turborepo"}`,
		`with turborepo including warmup: ${formatDuration(totals.withIncludingWarmup)}`,
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

function formatSignedDuration(durationMs) {
	const sign = durationMs > 0 ? "+" : "";
	return `${sign}${formatDuration(durationMs)}`;
}

function totalDuration(steps) {
	return steps.reduce((total, step) => total + step.durationMs, 0);
}
