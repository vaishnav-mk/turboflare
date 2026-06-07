# Turboflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vaishnav-mk/turboflare)

Cloudflare-native remote cache for Turborepo. Fast Worker hot path. R2-backed artifacts. Self-hostable in minutes.

Full docs live in `apps/docs`:

```sh
pnpm docs:dev
```

## Why

Turborepo remote cache should be boring infra:

| Need                     | Turboflare gives you                                     |
| ------------------------ | -------------------------------------------------------- |
| Fast global reads        | Cloudflare Workers + optional Cache API                  |
| Durable artifact storage | R2 as the default source of truth                        |
| Simple auth              | static bearer tokens, scoped tokens, optional D1 tokens  |
| Ops control              | retention cleanup, lifecycle rules, internal purge/stats |
| Stock Turbo support      | `/v8/artifacts` protocol plus `/v2` team discovery       |

## Quick Start

Deploy with the button above, then set a Worker secret named `TURBO_TOKEN` in the Cloudflare dashboard. If using Wrangler:

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Point Turborepo at your Worker:

```sh
export TURBO_API="https://<worker-name>.<subdomain>.workers.dev"
export TURBO_TOKEN="<same token>"
export TURBO_TEAM="team-name"

turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

The second run should report `cache hit`. If Turbo says it cannot connect over HTTPS but `curl` works, your network may be intercepting TLS with a certificate that Turbo's rustls client rejects. Try `http://<worker-name>.<subdomain>.workers.dev`, disable TLS inspection for the Worker host, or use a custom HTTPS domain.

Manual deploy:

```sh
pnpm install
pnpm deploy
```

`pnpm deploy` creates the configured R2 bucket if missing, then deploys the Worker.

## What Works

| Area           | Features                                                                     |
| -------------- | ---------------------------------------------------------------------------- |
| Turbo protocol | `GET/PUT/HEAD /v8/artifacts/:id`, batch lookup, events, status, preflight    |
| Storage        | streaming R2 uploads/downloads, optional KV mode for small artifacts         |
| Auth           | `TURBO_TOKEN`, scoped static tokens, optional D1 hashed tokens               |
| Teams          | `slug`, `teamId`, `team`, `/v2/user`, `/v2/teams`, `/v2/teams/:id`           |
| Safety         | read-only mode, signature-tag policy, artifact size limit                    |
| Branches       | shared, isolated, main-write-pr-read, read-only-pr policies                  |
| Ops            | R2 lifecycle setup, scheduled cleanup, internal stats/purge/token admin      |
| Observability  | Worker logs/observability, optional Analytics Engine, optional Rate Limiting |

## Agent And Smoke Tooling

This repo includes `scripts/remote/` for real deployed-worker smoke checks and `skills/turboflare-setup/` for coding agents that need to set up Turboflare without rediscovering the deployment flow.

## Architecture

Hot path stays small:

```txt
Turbo client
  -> Worker /v8/artifacts
  -> bearer auth
  -> tenant + branch resolution
  -> R2 key v1/team/{team}/artifact/{hash}
  -> R2 head/get/put
```

R2 is the recommended artifact store. KV exists only as an opt-in fallback and is capped by KV's 25 MiB value limit.

## Configuration

### Required

| Name          | Purpose                            |
| ------------- | ---------------------------------- |
| `ARTIFACTS`   | R2 bucket binding                  |
| `TURBO_TOKEN` | bearer token used by Turbo clients |

### Common Optional Vars

| Name                    | Values                                                     | Purpose                                                |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `CACHE_STATUS`          | `enabled`, `disabled`, `over_limit`, `paused`              | status response                                        |
| `READ_ONLY`             | `true` / `false`                                           | reject writes, allow reads                             |
| `SIGNATURE_POLICY`      | `off`, `accept`, `monitor`, `require`                      | require/preserve Turbo `x-artifact-tag`                |
| `BRANCH_CACHE_POLICY`   | `shared`, `isolated`, `main-write-pr-read`, `read-only-pr` | branch cache behavior                                  |
| `DEFAULT_BRANCH`        | branch name                                                | default `main`                                         |
| `RETENTION_DAYS`        | number                                                     | Worker cleanup/R2 lifecycle default                    |
| `BRANCH_RETENTION_DAYS` | number                                                     | shorter branch artifact cleanup                        |
| `MAX_ARTIFACT_BYTES`    | bytes                                                      | upload size guard when `Content-Length` exists         |
| `CACHE_API_READS`       | `true` / `false`                                           | fill Cloudflare Cache API after R2 reads               |
| `ARTIFACT_STORE`        | `r2`, `kv`                                                 | default `r2`; set `kv` only for small-artifact KV mode |
| `INTERNAL_ADMIN_TOKEN`  | secret                                                     | protects `/internal/*`                                 |

### Optional Bindings

| Binding          | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `TOKEN_DB`       | D1 hashed tokens and token admin APIs      |
| `ARTIFACT_INDEX` | D1 artifact metadata index                 |
| `ANALYTICS`      | Analytics Engine metrics                   |
| `RATE_LIMITER`   | Cloudflare Rate Limiting binding           |
| `ARTIFACTS_KV`   | KV artifact store when `ARTIFACT_STORE=kv` |

If you use D1-backed tokens or artifact indexing, apply the matching schema in `apps/cache-worker/schema/`.

## Auth

Single token:

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Scoped static tokens:

```json
[
  {
    "id": "ci-write",
    "token": "secret-token",
    "teams": ["team_turboflare"],
    "scopes": ["read", "write"]
  }
]
```

Set that JSON as `TURBO_TOKEN_SCOPES`. Use D1 tokens only when you need rotation, audit rows, or many teams.

## Signatures

Turbo signed remote cache uses `x-artifact-tag`. Turboflare preserves it and can require it:

```txt
SIGNATURE_POLICY=require
```

Client-side Turbo config:

```json
{
  "remoteCache": {
    "signature": true
  }
}
```

Then set `TURBO_REMOTE_CACHE_SIGNATURE_KEY` in your build environment.

## Retention

R2 lifecycle is the simplest expiry path:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... pnpm r2:lifecycle
```

It deletes `v1/` artifacts after `RETENTION_DAYS` and aborts stale multipart uploads after `ABORT_MULTIPART_DAYS`.

The Worker cron also runs bounded cleanup. Keep it if you use KV, D1 artifact index cleanup, or branch-specific TTLs.

## Internal Admin

Set `INTERNAL_ADMIN_TOKEN` before using `/internal/*`:

```sh
wrangler secret put INTERNAL_ADMIN_TOKEN --config apps/cache-worker/wrangler.jsonc
```

| Route                                    | Purpose                     |
| ---------------------------------------- | --------------------------- |
| `GET /internal/health`                   | internal health check       |
| `GET /internal/teams/:team/stats`        | object count and bytes      |
| `POST /internal/teams/:team/purge-all`   | delete one team's artifacts |
| `POST /internal/artifacts/purge-expired` | run cleanup now             |
| `GET /internal/tokens`                   | list D1 token metadata      |
| `POST /internal/tokens`                  | create D1 token             |
| `POST /internal/tokens/:id/revoke`       | revoke D1 token             |

## Development

```sh
pnpm install
pnpm check
pnpm --filter @turboflare/cache-worker dev
```

Useful commands:

| Command                     | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `pnpm test`                 | unit tests                                   |
| `pnpm test:integration`     | real Turbo fixture against Worker handler    |
| `pnpm build`                | Wrangler dry-run bundle                      |
| `pnpm docs:dev`             | run the docs app locally                     |
| `pnpm docs:build`           | build the docs app                           |
| `pnpm r2:lifecycle:dry-run` | print lifecycle payload                      |
| `pnpm prune:smoke web`      | optional pruned workspace remote-cache smoke |

## Status

Turboflare is ready to self-host. The default path is intentionally simple: Worker + R2 + one token. Add D1, Analytics Engine, Rate Limiting, KV, branch policies, and signature enforcement only when you need them.
