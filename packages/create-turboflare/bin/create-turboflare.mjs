#!/usr/bin/env node
import { confirm, intro, isCancel, note, outro, password, spinner, text } from "@clack/prompts";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { execa } from "execa";
import { downloadTemplate } from "giget";

const DEFAULT_SOURCE = "github:vaishnav-mk/turboflare#main";
const DEFAULT_ENV_FILE = ".env.turboflare";
const MIN_NODE_MAJOR = 20;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`create-turboflare

Usage:
  pnpm dlx "github:vaishnav-mk/turboflare#path:packages/create-turboflare"

Environment:
  TURBOFLARE_SOURCE  giget source. Defaults to ${DEFAULT_SOURCE}

Creates a temporary Turboflare checkout, deploys the Worker with Wrangler, sets TURBO_TOKEN, writes .env.turboflare, then deletes the temporary checkout.`);
  process.exit(0);
}

const scriptedAnswers = input.isTTY ? null : (await readScriptedAnswers()).split(/\r?\n/);
const isInteractive = scriptedAnswers === null;
let workdir;

try {
  await main();
} catch (error) {
  fail(error);
} finally {
  if (workdir !== undefined) {
    await rm(workdir, { force: true, recursive: true });
  }
}

async function main() {
  intro("Create Turboflare");
  note(
    "Downloads Turboflare to a temp directory, deploys it, sets TURBO_TOKEN, then removes the temp checkout.",
    "What this does",
  );

  await preflight();

  const team = teamName(await promptText("Turbo team name", defaultTeamName()));
  const token = await turboToken();
  const writeEnv = await promptConfirm(`Write ${DEFAULT_ENV_FILE} in this directory?`, true);
  const source = process.env.TURBOFLARE_SOURCE ?? DEFAULT_SOURCE;

  workdir = join(tmpdir(), `create-turboflare-${randomBytes(8).toString("hex")}`);
  await withStep(`Downloading ${source}`, () =>
    downloadTemplate(source, { dir: workdir, forceClean: true, registry: false }),
  );

  const config = JSON.parse(
    stripJsonComments(await readFile(join(workdir, "apps/cache-worker/wrangler.jsonc"), "utf8")),
  );
  const bucketName = requiredString(config.r2_buckets?.[0]?.bucket_name, "R2 bucket name");

  await run("pnpm", ["install", "--frozen-lockfile"], {
    cwd: workdir,
    label: "Installing dependencies",
  });
  await ensureWranglerLogin(workdir);
  await createBucket(workdir, bucketName);

  const deploy = await run("pnpm", ["--filter", "@turboflare/cache-worker", "deploy"], {
    cwd: workdir,
    label: "Deploying Worker",
  });
  const workerUrl = normalizeWorkerUrl(
    deployedWorkerUrl(deploy.stdout) ?? (await promptText("Worker URL")),
  );

  await putSecret(workdir, "TURBO_TOKEN", token);
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
  note(lines.join("\n"), "Setup complete");
  outro("Turboflare is ready.");
}

async function preflight() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    throw new Error(`Node.js ${MIN_NODE_MAJOR}+ is required. Current version: ${process.version}`);
  }

  await requireCommand("pnpm", ["--version"], "pnpm is required. Install it with corepack or npm.");
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

async function ensureWranglerLogin(repo) {
  const result = await run(
    "pnpm",
    ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "whoami"],
    { cwd: repo, reject: false, label: "Checking Wrangler login" },
  );
  if (result.exitCode === 0) {
    return;
  }

  if (!(await promptConfirm("Wrangler is not logged in. Run wrangler login now?", true))) {
    throw new Error("Wrangler login is required before deploying Turboflare");
  }

  await run("pnpm", ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "login"], {
    cwd: repo,
    label: "Opening Wrangler login",
  });
  await run("pnpm", ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "whoami"], {
    cwd: repo,
    label: "Checking Wrangler login",
  });
}

async function createBucket(repo, bucketName) {
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
    { cwd: repo, reject: false, label: `Creating R2 bucket ${bucketName}` },
  );
  if (result.exitCode === 0) {
    return;
  }

  if (/already exists|bucket.*exists|already own/i.test(`${result.stdout}\n${result.stderr}`)) {
    info(`R2 bucket ${bucketName} already exists`);
    return;
  }

  throw new Error(`failed to create R2 bucket ${bucketName}`);
}

async function putSecret(repo, name, value) {
  await run(
    "pnpm",
    ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "secret", "put", name],
    { cwd: repo, input: value, label: `Setting Worker secret ${name}` },
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

  note(
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
    info(`${DEFAULT_ENV_FILE} unchanged`);
    return false;
  }

  await writeFile(
    DEFAULT_ENV_FILE,
    `TURBO_API=${workerUrl}\nTURBO_TOKEN=${token}\nTURBO_TEAM=${team}\n`,
    { mode: 0o600 },
  );
  return true;
}

async function run(command, args, options = {}) {
  const result = await withStep(options.label ?? `${command} ${args.join(" ")}`, () =>
    execa(command, args, {
      cwd: options.cwd,
      input: options.input,
      reject: false,
    }),
  );

  if (result.exitCode !== 0 && options.reject !== false) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.exitCode}${details ? `\n${details}` : ""}`,
    );
  }

  return result;
}

async function requireCommand(command, args, message) {
  const result = await execa(command, args, { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(message);
  }
}

async function promptText(label, defaultValue) {
  const suffix = defaultValue === undefined ? "" : ` (${defaultValue})`;
  if (!isInteractive) {
    output.write(`${label}${suffix}:\n`);
    const answer = scriptedAnswers.shift() ?? "";
    const trimmed = answer.trim();
    return trimmed.length === 0 && defaultValue !== undefined ? defaultValue : trimmed;
  }

  const answer = await text({ message: label, defaultValue, placeholder: defaultValue });
  return unwrapPrompt(answer).trim();
}

async function promptSecret(label) {
  if (!isInteractive) {
    output.write(`${label}:\n`);
    return (scriptedAnswers.shift() ?? "").trim();
  }

  const answer = await password({ message: label });
  return unwrapPrompt(answer).trim();
}

async function promptConfirm(label, defaultValue) {
  if (!isInteractive) {
    const answer = await promptText(`${label} ${defaultValue ? "[Y/n]" : "[y/N]"}`);
    if (answer.length === 0) {
      return defaultValue;
    }

    return /^(y|yes)$/i.test(answer);
  }

  return unwrapPrompt(await confirm({ message: label, initialValue: defaultValue }));
}

async function withStep(label, task) {
  if (!isInteractive) {
    output.write(`${label}\n`);
    return task();
  }

  const spin = spinner();
  spin.start(label);
  try {
    const result = await task();
    spin.stop(label);
    return result;
  } catch (error) {
    spin.stop(`${label} failed`);
    throw error;
  }
}

function unwrapPrompt(value) {
  if (isCancel(value)) {
    throw new Error("setup cancelled");
  }

  return value;
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

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function stripJsonComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

async function readScriptedAnswers() {
  const chunks = [];
  for await (const chunk of input) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function exists(path) {
  return readFile(path)
    .then(() => true)
    .catch(() => false);
}

function info(message) {
  if (isInteractive) {
    note(message);
    return;
  }

  output.write(`${message}\n`);
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (isInteractive) {
    outro(`Setup failed: ${message}`);
  } else {
    console.error(`Setup failed: ${message}`);
  }
  process.exitCode = 1;
}
