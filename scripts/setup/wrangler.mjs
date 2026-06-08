import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { requiredString, stripJsonComments } from "../shared/jsonc.mjs";
import {
  fail,
  finish,
  printNote,
  promptConfirm,
  promptSecret,
  promptText,
  requireCommand,
  run,
  start,
  withStep,
} from "../shared/setup-cli.mjs";

const CONFIG_PATH = "apps/cache-worker/wrangler.jsonc";
const DEFAULT_ENV_FILE = ".env.turboflare";
const MIN_NODE_MAJOR = 20;

try {
  await main();
} catch (error) {
  fail(error);
}

async function main() {
  const config = JSON.parse(stripJsonComments(await readFile(CONFIG_PATH, "utf8")));
  const workerName = requiredString(config.name, "Worker name");
  const bucketName = requiredString(config.r2_buckets?.[0]?.bucket_name, "R2 bucket name");

  start("Turboflare guided setup");
  printNote(
    [
      `Worker config: ${CONFIG_PATH}`,
      `Worker name: ${workerName}`,
      `R2 bucket: ${bucketName}`,
    ].join("\n"),
    "Worker",
  );

  await preflight();

  const team = teamName(await promptText("Turbo team name", defaultTeamName()));
  const token = await turboToken();
  const writeEnv = await promptConfirm(`Write ${DEFAULT_ENV_FILE} for local Turbo commands?`, true);
  const deploy = await promptConfirm(
    "Create R2 bucket, deploy Worker, and set TURBO_TOKEN now?",
    true,
  );

  await ensureDependencies();
  await ensureWranglerLogin();

  if (!deploy) {
    await writeClientEnv(writeEnv, null, team, token);
    printManualNextSteps(bucketName, team);
    finish("Manual setup steps ready.");
    return;
  }

  await createBucket(bucketName);
  const deployResult = await run("pnpm", ["--filter", "@turboflare/cache-worker", "deploy"], {
    label: "Deploying Worker",
  });
  const workerUrl = normalizeWorkerUrl(
    deployedWorkerUrl(deployResult.stdout) ?? (await promptText("Worker URL")),
  );

  await putSecret("TURBO_TOKEN", token);
  const envWritten = await writeClientEnv(writeEnv, workerUrl, team, token);
  await smoke(workerUrl, token);

  const lines = [
    `TURBO_API=${workerUrl}`,
    `TURBO_TEAM=${team}`,
    "TURBO_TOKEN saved as Worker secret TURBO_TOKEN",
  ];
  if (envWritten) {
    lines.push(`Local Turbo env written to ${DEFAULT_ENV_FILE}`);
  }
  printNote(lines.join("\n"), "Setup complete");
  finish("Turboflare is ready.");
}

async function preflight() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    throw new Error(`Node.js ${MIN_NODE_MAJOR}+ is required. Current version: ${process.version}`);
  }

  await requireCommand("pnpm", ["--version"], "pnpm is required. Install it with corepack or npm.");
}

async function ensureDependencies() {
  if (await exists("node_modules")) {
    return;
  }

  if (await promptConfirm("node_modules is missing. Run pnpm install?", true)) {
    await run("pnpm", ["install"], { label: "Installing dependencies" });
  }
}

async function turboToken() {
  if (await promptConfirm("Generate a new TURBO_TOKEN?", true)) {
    return `tf_${randomBytes(32).toString("base64url")}`;
  }

  const token = await promptSecret("Paste TURBO_TOKEN value");
  if (token.length === 0) {
    throw new Error("TURBO_TOKEN cannot be empty");
  }

  return token;
}

async function ensureWranglerLogin() {
  const result = await run(
    "pnpm",
    ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "whoami"],
    { reject: false, label: "Checking Wrangler login" },
  );
  if (result.exitCode === 0) {
    return;
  }

  if (!(await promptConfirm("Wrangler is not logged in. Run wrangler login now?", true))) {
    throw new Error("Wrangler login is required before deploying Turboflare");
  }

  await run("pnpm", ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "login"], {
    label: "Opening Wrangler login",
  });
  await run("pnpm", ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "whoami"], {
    label: "Checking Wrangler login",
  });
}

async function createBucket(bucketName) {
  const result = await run(
    "pnpm",
    [
      "--filter",
      "@turboflare/cache-worker",
      "exec",
      "wrangler",
      "r2",
      "bucket",
      "create",
      bucketName,
    ],
    { reject: false, label: `Creating R2 bucket ${bucketName}` },
  );
  if (result.exitCode === 0) {
    return;
  }

  if (/already exists|bucket.*exists|already own/i.test(`${result.stdout}\n${result.stderr}`)) {
    printNote(`R2 bucket ${bucketName} already exists`);
    return;
  }

  throw new Error(`failed to create R2 bucket ${bucketName}`);
}

async function putSecret(name, value) {
  await run(
    "pnpm",
    ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "secret", "put", name],
    { input: value, label: `Setting Worker secret ${name}` },
  );
}

async function smoke(workerUrl, token) {
  const base = workerUrl.replace(/\/$/, "");
  const [health, unauthenticated, authenticated] = await withStep("Running smoke checks", () =>
    Promise.all([
      fetch(`${base}/management/health`),
      fetch(`${base}/v8/artifacts/status`),
      fetch(`${base}/v8/artifacts/status`, { headers: { Authorization: `Bearer ${token}` } }),
    ]),
  );

  printNote(
    [
      `GET /management/health -> ${health.status}`,
      `GET /v8/artifacts/status without auth -> ${unauthenticated.status}`,
      `GET /v8/artifacts/status with auth -> ${authenticated.status}`,
    ].join("\n"),
    "Smoke checks",
  );

  if (health.status !== 200 || unauthenticated.status !== 401 || authenticated.status !== 200) {
    throw new Error("smoke checks failed");
  }
}

async function writeClientEnv(writeEnv, workerUrl, team, token) {
  if (!writeEnv) {
    return false;
  }

  if (
    (await exists(DEFAULT_ENV_FILE)) &&
    !(await promptConfirm(`${DEFAULT_ENV_FILE} exists. Overwrite it?`, false))
  ) {
    printNote(`${DEFAULT_ENV_FILE} unchanged`);
    return false;
  }

  const api = workerUrl ?? "https://<worker-name>.<subdomain>.workers.dev";
  await writeFile(
    DEFAULT_ENV_FILE,
    `TURBO_API=${api}\nTURBO_TOKEN=${token}\nTURBO_TEAM=${team}\n`,
    { mode: 0o600 },
  );
  return true;
}

function printManualNextSteps(bucketName, team) {
  printNote(
    [
      `wrangler r2 bucket create ${bucketName}`,
      "pnpm --filter @turboflare/cache-worker deploy",
      `wrangler secret put TURBO_TOKEN --config ${CONFIG_PATH}`,
      `TURBO_TEAM=${team}`,
    ].join("\n"),
    "Manual next steps",
  );
}

function deployedWorkerUrl(stdout) {
  const match = stdout.match(/https:\/\/[^\s]+\.workers\.dev/);
  return match?.[0] ?? null;
}

function defaultTeamName() {
  return process.cwd().split("/").filter(Boolean).at(-1) ?? "my-team";
}

function teamName(value) {
  if (!/^\S+$/.test(value)) {
    throw new Error("Turbo team name cannot be empty or contain whitespace");
  }

  return value;
}

function normalizeWorkerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Worker URL must be a valid https:// URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Worker URL must use https://");
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

async function exists(path) {
  return access(path)
    .then(() => true)
    .catch(() => false);
}
