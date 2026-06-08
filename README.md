# Turboflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vaishnav-mk/turboflare)

Cloudflare-native remote cache for Turborepo. Worker hot path. R2-backed artifacts. Self-hostable.

Docs: <https://turboflare.vaishnav.one/>

## Alpha

Turboflare is alpha software. Expect breaking changes, config changes, route changes, storage layout changes, and docs drift while the project hardens. Do not treat it as a stable Cloudflare product.

Use it if you are comfortable owning your deployment and reading the code when something breaks.

## What It Does

- Implements Turbo remote cache routes under `/v8/artifacts`.
- Stores artifacts in R2 by default.
- Supports static bearer tokens, scoped tokens, and optional D1-backed tokens.
- Supports `/v2` Turbo identity compatibility.
- Includes optional branch policies, signature enforcement, cleanup, Cache API reads, Analytics Engine metrics, and Rate Limiting.

## Quick Start

Clone-free guided setup:

```sh
pnpm dlx create-turboflare
```

Manual setup: deploy with the button above or from a source checkout, then set a Worker secret named `TURBO_TOKEN`.

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Point Turbo at the Worker:

```sh
export TURBO_API="https://<worker-name>.<subdomain>.workers.dev"
export TURBO_TOKEN="<same token>"
export TURBO_TEAM="team-name"

turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

The second run should report a remote cache hit.

Manual deploy:

```sh
pnpm install
pnpm deploy
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

`pnpm setup` is the guided source-checkout setup for contributors or customized deploys.

## Useful Links

- Docs: <https://turboflare.vaishnav.one/>
- Getting started: <https://turboflare.vaishnav.one/guide/getting-started/>
- API reference: <https://turboflare.vaishnav.one/reference/api/>
- Deployment guide: <https://turboflare.vaishnav.one/guide/deploy/>
- Configuration: <https://turboflare.vaishnav.one/guide/configuration/>
- Troubleshooting: <https://turboflare.vaishnav.one/guide/troubleshooting/>

## Development

```sh
pnpm install
pnpm check
pnpm --filter @turboflare/cache-worker dev
```

Useful commands:

| Command                     | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `pnpm check`                | full local verification                   |
| `pnpm test`                 | unit tests                                |
| `pnpm test:integration`     | real Turbo fixture against Worker handler |
| `pnpm build`                | Worker dry-run bundle + docs build        |
| `pnpm docs:dev`             | run docs locally                          |
| `pnpm r2:lifecycle:dry-run` | print R2 lifecycle payload                |
