import { execFile } from "node:child_process";

const tasks = words(process.env.TURBO_WARM_TASKS ?? "build");
const filters = commaList(process.env.TURBO_WARM_FILTERS);
const timeout = process.env.TURBO_REMOTE_CACHE_TIMEOUT ?? "20";

if (process.env.TURBO_API === undefined || process.env.TURBO_TOKEN === undefined || process.env.TURBO_TEAM === undefined) {
	throw new Error("TURBO_API, TURBO_TOKEN, and TURBO_TEAM are required");
}

const args = ["turbo", "run", ...tasks, "--cache=local:,remote:w", "--remote-cache-timeout", timeout, ...filters.flatMap((filter) => ["--filter", filter])];
await run("pnpm", args);

function run(command, args) {
	return new Promise((resolve, reject) => {
		console.log(`${command} ${args.join(" ")}`);
		execFile(command, args, { env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" } }, (error, stdout, stderr) => {
			process.stdout.write(stdout);
			process.stderr.write(stderr);
			if (error !== null) {
				reject(error);
				return;
			}

			resolve();
		});
	});
}

function words(value) {
	return value.split(/\s+/).filter(Boolean);
}

function commaList(value) {
	return value === undefined ? [] : value.split(",").map((item) => item.trim()).filter(Boolean);
}
