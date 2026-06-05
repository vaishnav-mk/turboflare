import { readFileSync } from "node:fs";

const DEFAULT_ABORT_MULTIPART_DAYS = 1;
const SECONDS_PER_DAY = 24 * 60 * 60;
const WRANGLER_CONFIG = "apps/cache-worker/wrangler.jsonc";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const config = JSON.parse(stripJsonComments(readFileSync(WRANGLER_CONFIG, "utf8")));
const bucketName = requiredString(process.env.R2_BUCKET_NAME ?? config.r2_buckets?.[0]?.bucket_name, "R2 bucket name");
const retentionDays = positiveInteger(process.env.RETENTION_DAYS ?? config.vars?.RETENTION_DAYS, "RETENTION_DAYS");
const abortMultipartDays = positiveInteger(process.env.ABORT_MULTIPART_DAYS ?? DEFAULT_ABORT_MULTIPART_DAYS, "ABORT_MULTIPART_DAYS");

const body = {
	rules: [
		{
			conditions: { prefix: "v1/" },
			deleteObjectsTransition: { condition: { maxAge: retentionDays * SECONDS_PER_DAY, type: "Age" } },
			enabled: true,
			id: `expire-turboflare-artifacts-after-${retentionDays}-${dayLabel(retentionDays)}`,
		},
		{
			abortMultipartUploadsTransition: { condition: { maxAge: abortMultipartDays * SECONDS_PER_DAY, type: "Age" } },
			conditions: { prefix: "v1/" },
			enabled: true,
			id: `abort-turboflare-multipart-after-${abortMultipartDays}-${dayLabel(abortMultipartDays)}`,
		},
	],
};

if (dryRun) {
	console.log(JSON.stringify({ bucketName, body }, null, 2));
	process.exit(0);
}

const accountId = requiredString(process.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
const apiToken = requiredString(process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/lifecycle`);
const response = await fetch(url, {
	body: JSON.stringify(body),
	headers: {
		Authorization: `Bearer ${apiToken}`,
		"Content-Type": "application/json",
		...(process.env.R2_JURISDICTION === undefined ? {} : { "cf-r2-jurisdiction": process.env.R2_JURISDICTION }),
	},
	method: "PUT",
});
const result = await response.json().catch(() => ({}));
if (!response.ok || result.success === false) {
	throw new Error(`failed to configure R2 lifecycle: ${response.status} ${JSON.stringify(result)}`);
}

console.log(JSON.stringify({ bucketName, rules: body.rules.length, success: true }, null, 2));

function requiredString(value, name) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${name} is required`);
	}

	return value.trim();
}

function positiveInteger(value, name) {
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}

	return parsed;
}

function dayLabel(value) {
	return value === 1 ? "day" : "days";
}

function stripJsonComments(value) {
	let output = "";
	let inString = false;
	let escaping = false;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		const next = value[index + 1];

		if (!inString && character === "/" && next === "/") {
			while (index < value.length && value[index] !== "\n") {
				index += 1;
			}
			output += value[index] ?? "";
			continue;
		}

		output += character;
		if (escaping) {
			escaping = false;
			continue;
		}

		if (character === "\\") {
			escaping = true;
			continue;
		}

		if (character === '"') {
			inString = !inString;
		}
	}

	return output;
}
