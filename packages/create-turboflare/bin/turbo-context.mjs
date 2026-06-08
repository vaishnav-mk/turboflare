import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const TURBO_CONFIG_FILES = ["turbo.json", "turbo.jsonc"];

export async function turboContext(directory = process.cwd()) {
  const root = await findTurboRoot(directory);
  if (root === null) {
    return null;
  }

  const configPath = requiredString(await turboConfigPath(root), "Turbo config path");
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
  return { config, configPath, root };
}

export async function findTurboRoot(directory) {
  const current = resolve(directory);
  const parent = dirname(current);
  const parentRoot = parent === current ? null : await findTurboRoot(parent);
  if (parentRoot !== null) {
    return parentRoot;
  }

  return (await turboConfigPath(current)) === null ? null : current;
}

export async function turboConfigPath(directory) {
  const matches = await Promise.all(
    TURBO_CONFIG_FILES.map(async (file) => {
      const path = join(directory, file);
      return (await exists(path)) ? path : null;
    }),
  );
  return matches.find((path) => path !== null) ?? null;
}

export function isRemoteCacheDisabled(config) {
  return config.remoteCache?.enabled === false || config.global?.remoteCache?.enabled === false;
}

export async function turboCommand(root) {
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

export async function packageManager(root) {
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

export function turboCachePath(context) {
  const cacheDir = context.config.global?.cacheDir ?? context.config.cacheDir;
  const cachePath =
    typeof cacheDir === "string" && cacheDir.trim().length > 0
      ? resolve(context.root, cacheDir)
      : join(context.root, ".turbo");
  const fromRoot = relative(context.root, cachePath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Turbo cacheDir resolves outside the Turbo root: ${cachePath}`);
  }

  return cachePath;
}

async function readJson(path) {
  return readFile(path, "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => ({}));
}

async function exists(path) {
  return access(path)
    .then(() => true)
    .catch(() => false);
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
