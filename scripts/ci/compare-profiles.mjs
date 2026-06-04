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

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown);

if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
	await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
}

if (!withProfile.success || !withoutProfile.success) {
	process.exit(1);
}

function readProfile(path) {
	return readFile(path, "utf8").then((contents) => JSON.parse(contents));
}

function comparisonMarkdown(withProfile, withoutProfile) {
	const withSteps = byId(withProfile.steps);
	const withoutSteps = byId(withoutProfile.steps);
	const ids = [...new Set([...Object.keys(withSteps), ...Object.keys(withoutSteps)])];
	const lines = [
		"# ci comparison",
		"",
		`with turborepo: ${withProfile.success ? "pass" : "fail"}`,
		`without turborepo: ${withoutProfile.success ? "pass" : "fail"}`,
		"",
		"| step | with turborepo | without turborepo | delta | faster |",
		"| --- | ---: | ---: | ---: | --- |",
	];

	for (const id of ids) {
		const withStep = withSteps[id];
		const withoutStep = withoutSteps[id];
		const delta = withStep !== undefined && withoutStep !== undefined ? withStep.durationMs - withoutStep.durationMs : undefined;
		lines.push(
			`| ${withStep?.label ?? withoutStep?.label ?? id} | ${stepCell(withStep)} | ${stepCell(withoutStep)} | ${deltaCell(delta)} | ${winnerCell(delta)} |`
		);
	}

	lines.push("", "## command diffs", "");

	for (const id of ids) {
		const withStep = withSteps[id];
		const withoutStep = withoutSteps[id];
		lines.push(`### ${withStep?.label ?? withoutStep?.label ?? id}`, "", "```diff", `- ${withStep?.command ?? "missing"}`, `+ ${withoutStep?.command ?? "missing"}`, "```", "");
	}

	lines.push("## output tails", "");

	for (const id of ids) {
		const withStep = withSteps[id];
		const withoutStep = withoutSteps[id];
		lines.push(`### ${withStep?.label ?? withoutStep?.label ?? id}`, "", "with turborepo", "", "```txt", withStep?.stdoutTail ?? "missing", "```", "");
		lines.push("without turborepo", "", "```txt", withoutStep?.stdoutTail ?? "missing", "```", "");
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
