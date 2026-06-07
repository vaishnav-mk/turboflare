# Getting Started

Turboflare gives Turborepo a remote cache endpoint backed by Cloudflare Workers and R2.

## 1. Deploy

Use the deploy button from the landing page, or deploy manually:

```sh
pnpm install
pnpm deploy
```

`pnpm deploy` creates the configured R2 bucket when missing, then deploys `apps/cache-worker`.

## 2. Set a Turbo token

In the Cloudflare dashboard, add a Worker secret named `TURBO_TOKEN`.

With Wrangler:

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Use a long random token. Turborepo sends it as `Authorization: Bearer <token>`.

## 3. Point Turborepo at the Worker

```sh
export TURBO_API="https://<worker-name>.<subdomain>.workers.dev"
export TURBO_TOKEN="<same token>"
export TURBO_TEAM="team-name"
```

Run Turbo normally:

```sh
turbo run build
```

## 4. Confirm it works

Run the same task twice from a clean state. The first run uploads artifacts. A later matching task hash should restore from remote cache.

You can also check basic endpoint behavior:

| Request | Expected |
| --- | --- |
| `GET /management/health` | `200` |
| unauthenticated `GET /v8/artifacts/status` | `401` |
| authenticated `GET /v8/artifacts/status` | `{ "status": "enabled" }` |

## What gets cached?

Turboflare stores Turbo task cache artifacts for task hashes. It does not store deployments and it does not warm future commits automatically.

| Thing | Example |
| --- | --- |
| artifact id | Turbo task hash |
| metadata | duration, tag, SHA, dirty hash |
| body | compressed task outputs from Turbo |
| storage key | `v1/team/{team}/artifact/{hash}` |

## Recommended production baseline

| Area | Recommended setting |
| --- | --- |
| storage | R2 default |
| auth | `TURBO_TOKEN` or scoped static tokens |
| retention | R2 lifecycle enabled |
| admin | separate `INTERNAL_ADMIN_TOKEN` if using `/internal/*` |
| branch policy | keep `shared` unless you need PR isolation |
| signatures | use `SIGNATURE_POLICY=require` for stricter CI |
