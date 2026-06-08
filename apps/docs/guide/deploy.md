# Deploy

Turboflare has two deploy paths: one-click deploy for quick setup, and manual Wrangler deploy for controlled environments.

If you want Turboflare to ask questions and fill the standard values without keeping a source checkout, use clone-free setup instead:

```sh
pnpm dlx create-turboflare
```

## One-click deploy

Use the deploy button on the docs homepage or README.

The deploy flow runs the repository's root deploy script:

```sh
pnpm deploy
```

That script:

| Step | What happens                                |
| ---- | ------------------------------------------- |
| 1    | reads `apps/cache-worker/wrangler.jsonc`    |
| 2    | creates the configured R2 bucket if missing |
| 3    | deploys `apps/cache-worker` with Wrangler   |

After deployment, add a Worker secret named `TURBO_TOKEN` in the Cloudflare dashboard.

## Manual deploy

```sh
pnpm install
pnpm deploy
```

Expected output includes a Worker URL:

```txt
https://turboflare-cache-worker.<subdomain>.workers.dev
```

Use that URL as `TURBO_API`.

## Worker-only deploy

If you already created the bucket:

```sh
pnpm --filter @turboflare/cache-worker deploy
```

This skips the root bucket-creation helper.

## Bucket setup

Default bucket config:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "ARTIFACTS",
      "bucket_name": "turboflare-artifacts",
    },
  ],
}
```

Manual bucket creation:

```sh
wrangler r2 bucket create turboflare-artifacts
```

If you change the bucket name in `wrangler.jsonc`, `pnpm deploy` will use the new name.

## Required secret

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

For local testing, you can use any long random string. Use the same value in your Turbo client environment.

## Optional admin secret

```sh
wrangler secret put INTERNAL_ADMIN_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Only set this if you want `/internal/*` admin routes. These routes fail closed when the secret is missing.

## Smoke checks

```sh
curl -i https://<worker>/management/health
```

Expected:

| Check           | Result |
| --------------- | ------ |
| health endpoint | `200`  |

Authenticated status:

```sh
curl -H "Authorization: Bearer $TURBO_TOKEN" \
  "$TURBO_API/v8/artifacts/status"
```

Expected:

The Worker should accept the matching Turbo token with `200`. Without auth, the same status route should return `401`.

## Deploy docs separately

The docs app is static and lives in `apps/docs`.

```sh
pnpm --filter @turboflare/docs build
```

Static output:

```txt
apps/docs/dist
```

Deploy it to Cloudflare Pages or any static host. Keep the cache Worker and docs app as separate deploy targets.
