#!/usr/bin/env node
import { confirm, intro, isCancel, note, outro, password, text } from "@clack/prompts";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { execa } from "execa";
import { downloadTemplate } from "giget";

const DEFAULT_SOURCE = "github:vaishnav-mk/turboflare#main";
const DEFAULT_ENV_FILE = ".env.turboflare";
const MIN_NODE_MAJOR = 20;
const TURBO_CONFIG_FILES = ["turbo.json", "turbo.jsonc"];

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`create-turboflare

Usage:
  pnpm dlx create-turboflare

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
  const setupStartedAt = Date.now();
  intro("Create Turboflare");
  note(
    [
      "This runs from your app repo. It downloads Turboflare to a temporary directory, deploys the Worker, then deletes the temporary checkout.",
      "You need a Wrangler login because the installer creates Cloudflare resources in your account.",
    ].join("\n"),
    "What this does",
  );

  await preflight();

  note(
    [
      "TURBO_TEAM is just Turbo's namespace for cache entries.",
      "Use a stable short name for this repo or org, for example acme-web or my-app.",
      "Use the same TURBO_TEAM in local dev and CI when you want them to share cache artifacts.",
    ].join("\n"),
    "Turbo team name",
  );
  const team = teamName(await promptText("Turbo team name", defaultTeamName()));

  note(
    [
      "TURBO_TOKEN is the password Turbo sends to your Worker.",
      "Generating one is easiest. The installer stores it as a Worker secret and writes it to .env.turboflare if you choose that option.",
    ].join("\n"),
    "Turbo token",
  );
  const token = await turboToken();

  note(
    [
      ".env.turboflare is for your app shell only. It contains TURBO_API, TURBO_TEAM, and TURBO_TOKEN.",
      "Do not commit it. The repo gitignore excludes it.",
    ].join("\n"),
    "Local env file",
  );
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
  await run("pnpm", ["--filter", "@turboflare/protocol", "build"], {
    cwd: workdir,
    label: "Building shared protocol package",
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
  await maybeVerifyTurboCache(workerUrl, team, token);

  const lines = [
    `TURBO_API=${workerUrl}`,
    `TURBO_TEAM=${team}`,
    "TURBO_TOKEN saved as Worker secret TURBO_TOKEN",
  ];
  if (envWritten) {
    lines.push(`Local Turbo env written to ${DEFAULT_ENV_FILE}`);
  }
  lines.push(`Total setup time: ${formatDuration(Date.now() - setupStartedAt)}`);
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
  info("Checking Wrangler login. Wrangler tells Cloudflare which account to deploy into.");
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
  info(`Creating R2 bucket ${bucketName}. R2 stores Turbo cache artifact files.`);
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
  info(`Setting Worker secret ${name}. Secrets are stored by Cloudflare, not in Worker code.`);
  await run(
    "pnpm",
    ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "secret", "put", name],
    { cwd: repo, input: value, label: `Setting Worker secret ${name}` },
  );
}

async function smoke(workerUrl, token) {
  info(
    "Running smoke checks. These confirm the Worker is live, rejects missing auth, and accepts your token.",
  );
  const base = workerUrl.replace(/\/$/, "");
  const result = await withStep("Running smoke checks", () =>
    retrySmoke(async () => {
      const [health, unauthenticated, authenticated] = await Promise.all([
        fetch(`${base}/management/health`),
        fetch(`${base}/v8/artifacts/status`),
        fetch(`${base}/v8/artifacts/status`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      return {
        authenticated: authenticated.status,
        health: health.status,
        unauthenticated: unauthenticated.status,
      };
    }),
  );

  note(
    [
      `GET /management/health -> ${result.health}`,
      `GET /v8/artifacts/status without auth -> ${result.unauthenticated}`,
      `GET /v8/artifacts/status with auth -> ${result.authenticated}`,
    ].join("\n"),
    "Smoke checks",
  );
}

async function maybeVerifyTurboCache(workerUrl, team, token) {
  const context = await turboContext();
  if (context === null) {
    note(
      "No turbo.json or turbo.jsonc found in this directory or its parents, so the installer skipped the optional local Turbo cache check.",
      "Turbo cache check skipped",
    );
    return;
  }

  if (isRemoteCacheDisabled(context.config)) {
    note(
      `${context.configPath} has remoteCache.enabled=false, so Turbo will not use remote cache for this check. Enable remote cache before verifying Turboflare with Turbo.`,
      "Turbo cache check skipped",
    );
    return;
  }

  note(
    [
      "This optional check runs Turbo in this repo twice.",
      "First run writes to remote cache. Then setup removes the local Turbo cache to force a remote read. Second run should report cache hits.",
      `Turbo root: ${context.root}`,
      `Turbo config: ${context.configPath}`,
      "Only choose this if the selected tasks are safe to run now.",
    ].join("\n"),
    "Optional Turbo cache check",
  );

  if (!(await promptConfirm("Run a real Turbo remote cache check now?", false))) {
    return;
  }

  const tasks = turboTasks(await promptText("Turbo tasks to run", "build"));
  const turbo = await turboCommand(context.root);
  const env = { TURBO_API: workerUrl, TURBO_TEAM: team, TURBO_TOKEN: token };
  const verifyStartedAt = Date.now();
  try {
    await run(turbo.command, [...turbo.args, "--version"], {
      cwd: context.root,
      label: "Checking local Turbo install",
    });
    await run(turbo.command, [...turbo.args, "run", ...tasks, "--cache=local:,remote:w"], {
      cwd: context.root,
      env,
      label: `Running Turbo remote write for ${tasks.join(" ")}`,
      showOutput: true,
    });
    await rm(turboCachePath(context), { force: true, recursive: true });
    const read = await run(
      turbo.command,
      [...turbo.args, "run", ...tasks, "--cache=local:,remote:r"],
      {
        cwd: context.root,
        env,
        label: `Running Turbo remote read for ${tasks.join(" ")}`,
        showOutput: true,
      },
    );
    assertTurboCacheHit(read);
    note(
      [
        "Turbo write/read check finished and the second run reported a remote cache hit.",
        `Turbo verification time: ${formatDuration(Date.now() - verifyStartedAt)}`,
      ].join("\n"),
      "Turbo cache check complete",
    );
  } catch (error) {
    note(
      [
        "Turboflare is deployed, but the optional local Turbo check did not complete.",
        `If this repo has not installed dependencies yet, run ${turbo.installCommand} and retry your Turbo command with the .env.turboflare values.`,
        `Turbo verification time before stop: ${formatDuration(Date.now() - verifyStartedAt)}`,
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
      "Turbo cache check skipped",
    );
  }
}

async function turboContext() {
  const root = await findTurboRoot(process.cwd());
  if (root === null) {
    return null;
  }

  const configPath = requiredString(await turboConfigPath(root), "Turbo config path");
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
  return { config, configPath, root };
}

async function findTurboRoot(directory) {
  const current = resolve(directory);
  const parent = dirname(current);
  const parentRoot = parent === current ? null : await findTurboRoot(parent);
  if (parentRoot !== null) {
    return parentRoot;
  }

  return (await turboConfigPath(current)) === null ? null : current;
}

async function turboConfigPath(directory) {
  const matches = await Promise.all(
    TURBO_CONFIG_FILES.map(async (file) => {
      const path = join(directory, file);
      return (await exists(path)) ? path : null;
    }),
  );
  return matches.find((path) => path !== null) ?? null;
}

function isRemoteCacheDisabled(config) {
  return config.remoteCache?.enabled === false || config.global?.remoteCache?.enabled === false;
}

async function turboCommand(root) {
  const manager = await packageManager(root);
  if (manager === "npm") {
    return { args: ["exec", "turbo", "--"], command: "npm", installCommand: "npm install" };
  }
  if (manager === "yarn") {
    return { args: ["exec", "turbo"], command: "yarn", installCommand: "yarn install" };
  }
  if (manager === "bun") {
    return { args: ["x", "turbo"], command: "bun", installCommand: "bun install" };
  }

  return { args: ["exec", "turbo"], command: "pnpm", installCommand: "pnpm install" };
}

async function packageManager(root) {
  const packageJson = await readJson(join(root, "package.json"));
  const value = typeof packageJson.packageManager === "string" ? packageJson.packageManager : "";
  if (value.startsWith("npm@")) {
    return "npm";
  }
  if (value.startsWith("yarn@")) {
    return "yarn";
  }
  if (value.startsWith("bun@")) {
    return "bun";
  }
  if (value.startsWith("pnpm@")) {
    return "pnpm";
  }
  if (
    (await exists(join(root, "package-lock.json"))) ||
    (await exists(join(root, "npm-shrinkwrap.json")))
  ) {
    return "npm";
  }
  if (await exists(join(root, "yarn.lock"))) {
    return "yarn";
  }
  if ((await exists(join(root, "bun.lock"))) || (await exists(join(root, "bun.lockb")))) {
    return "bun";
  }

  return "pnpm";
}

async function readJson(path) {
  return readFile(path, "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => ({}));
}

function turboCachePath(context) {
  const cacheDir = context.config.global?.cacheDir ?? context.config.cacheDir;
  if (typeof cacheDir === "string" && cacheDir.trim().length > 0) {
    return resolve(context.root, cacheDir);
  }

  return join(context.root, ".turbo");
}

function assertTurboCacheHit(result) {
  const output = commandOutput(result).join("\n");
  if (/cache hit/i.test(output)) {
    return;
  }

  if (/remote caching unavailable|could not connect/i.test(output)) {
    throw new Error("Turbo ran, but remote caching was unavailable. Retry the Turbo check later.");
  }

  throw new Error("Turbo ran, but the second run did not report a remote cache hit.");
}

async function retrySmoke(check, attempt = 1) {
  const result = await check();
  if (result.health === 200 && result.unauthenticated === 401 && result.authenticated === 200) {
    return result;
  }

  if (attempt >= 12) {
    throw new Error(
      `smoke checks failed: health=${result.health}, unauthenticated=${result.unauthenticated}, authenticated=${result.authenticated}`,
    );
  }

  await sleep(5000);
  return retrySmoke(check, attempt + 1);
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
      env: options.env,
      input: options.input,
      reject: false,
    }),
  );

  if (result.exitCode !== 0 && options.reject !== false) {
    const details = commandOutput(result).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.exitCode}${details ? `\n${details}` : ""}`,
    );
  }

  if (options.showOutput) {
    for (const value of commandOutput(result)) {
      process.stdout.write(value);
      if (!value.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
  }

  return result;
}

function commandOutput(result) {
  return [result.stderr, result.stdout]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(/\r?\n/))
    .filter((value) => value.trim().length > 0 && value.trim() !== "undefined");
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
  output.write(`◇ ${label}\n`);
  try {
    const result = await task();
    output.write(`◇ ${label} done\n`);
    return result;
  } catch (error) {
    output.write(`◇ ${label} failed\n`);
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

function turboTasks(value) {
  const tasks = value.split(/\s+/).filter(Boolean);
  if (tasks.length === 0) {
    throw new Error("At least one Turbo task is required");
  }

  return tasks;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
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
