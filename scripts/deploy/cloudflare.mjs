import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { requiredString, stripJsonComments } from "../shared/jsonc.mjs";

const WRANGLER_CONFIG = "apps/cache-worker/wrangler.jsonc";
const config = JSON.parse(stripJsonComments(readFileSync(WRANGLER_CONFIG, "utf8")));
const bucketName = requiredString(
  process.env.R2_BUCKET_NAME ?? config.r2_buckets?.[0]?.bucket_name,
  "R2 bucket name",
);

await createBucket(bucketName);
await run("pnpm", ["--filter", "@turboflare/cache-worker", "deploy"]);

async function createBucket(name) {
  const result = await run(
    "pnpm",
    ["--filter", "@turboflare/cache-worker", "exec", "wrangler", "r2", "bucket", "create", name],
    { reject: false, silent: true },
  );
  if (result.exitCode === 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return;
  }

  if (bucketAlreadyExists(`${result.stdout}\n${result.stderr}`)) {
    console.log(`R2 bucket ${name} already exists`);
    return;
  }

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  throw new Error(`failed to create R2 bucket ${name}\n${result.stdout}\n${result.stderr}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`${command} ${args.join(" ")}`);
    execFile(command, args, (error, stdout, stderr) => {
      if (options.silent !== true) {
        process.stdout.write(stdout);
        process.stderr.write(stderr);
      }
      const result = { exitCode: error?.code ?? 0, stderr, stdout };
      if (error !== null && options.reject !== false) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

function bucketAlreadyExists(output) {
  return /already exists|bucket.*exists|already own/i.test(output);
}
