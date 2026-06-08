import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRemoteCacheDisabled,
  packageManager,
  turboCachePath,
  turboCommand,
  turboContext,
} from "../../packages/create-turboflare/bin/turbo-context.mjs";

await withFixture(async (root) => {
  await writeJson(join(root, "package.json"), { packageManager: "pnpm@11.5.0" });
  await writeJson(join(root, "turbo.json"), { cacheDir: ".cache/turbo", remoteCache: {} });
  await mkdir(join(root, "apps/web"), { recursive: true });
  await writeJson(join(root, "apps/web", "turbo.json"), { extends: ["//"], tasks: { build: {} } });

  const context = await turboContext(join(root, "apps/web"));
  assert.equal(context.root, root);
  assert.equal(context.configPath, join(root, "turbo.json"));
  assert.equal(turboCachePath(context), join(root, ".cache/turbo"));
  assert.equal(await packageManager(root), "pnpm");
  assert.deepEqual(await turboCommand(root), {
    args: ["exec", "turbo"],
    command: "pnpm",
    installCommand: "pnpm install",
  });
});

await withFixture(async (root) => {
  await writeJson(join(root, "package.json"), { packageManager: "npm@11.0.0" });
  await writeFile(
    join(root, "turbo.jsonc"),
    '{\n  // comments are allowed\n  "global": { "cacheDir": "tmp/turbo-cache", "remoteCache": { "enabled": false } },\n}\n',
  );

  const context = await turboContext(root);
  assert.equal(context.configPath, join(root, "turbo.jsonc"));
  assert.equal(isRemoteCacheDisabled(context.config), true);
  assert.equal(turboCachePath(context), join(root, "tmp/turbo-cache"));
  assert.deepEqual(await turboCommand(root), {
    args: ["exec", "turbo", "--"],
    command: "npm",
    installCommand: "npm install",
  });
});

await withFixture(async (root) => {
  await writeJson(join(root, "turbo.json"), { cacheDir: "../outside" });
  const context = await turboContext(root);
  assert.throws(() => turboCachePath(context), /outside the Turbo root/);
});

await withFixture(async (root) => {
  await writeJson(join(root, "turbo.json"), { cacheDir: "..cache/turbo" });
  const context = await turboContext(root);
  assert.equal(turboCachePath(context), join(root, "..cache/turbo"));
});

await withFixture(async (root) => {
  await writeJson(join(root, "turbo.json"), {});
  await writeFile(join(root, "yarn.lock"), "");
  assert.equal(await packageManager(root), "yarn");
});

await withFixture(async (root) => {
  await writeJson(join(root, "turbo.json"), {});
  await writeFile(join(root, "bun.lockb"), "");
  assert.equal(await packageManager(root), "bun");
});

await withFixture(async (root) => {
  await writeJson(join(root, "turbo.json"), { remoteCache: { enabled: false } });
  const context = await turboContext(root);
  assert.equal(isRemoteCacheDisabled(context.config), true);
});

console.log("turbo context smoke passed");

async function withFixture(task) {
  const root = await mkdtemp(join(tmpdir(), "turboflare-turbo-context-"));
  try {
    return await task(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
