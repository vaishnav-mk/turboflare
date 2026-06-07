# Turboflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vaishnav-mk/turboflare)

Turboflare is a speed-first, Cloudflare-native remote cache for Turborepo.

It is designed to be compatible with Turborepo's `/v8/artifacts` remote cache protocol while using Cloudflare Workers, R2, Cache API, Analytics Engine, Rate Limiting, D1, and optional KV artifact storage.

## Goal

Be the best self-hostable Turborepo remote cache for teams that want Cloudflare-native performance, control, observability, and enterprise operations.

## Why It Exists

Turborepo remote caching is most useful when cache reads and writes are boring, fast, and easy to operate. Turboflare keeps the artifact path small while putting deployment, auth, observability, and retention on Cloudflare primitives.

## Implemented Features

Turboflare implements the Turborepo `/v8/artifacts` remote cache protocol on Workers with R2 as the default artifact store:

- `GET /v8/artifacts/status`
- `PUT /v8/artifacts/:artifactId`
- `GET /v8/artifacts/:artifactId`
- `HEAD /v8/artifacts/:artifactId`
- `POST /v8/artifacts`
- `POST /v8/artifacts/events`
- `OPTIONS /v8/artifacts/*`
- `GET /management/health`

The hot path is intentionally hand-written and small: bearer auth, tenant normalization, versioned R2 key construction, R2 `head`/`get`/`put`, and response header preservation. Control-plane behavior stays under separate `/internal/*` routes.

Current implementation details:

- R2 object keys use `v1/team/{teamKey}/artifact/{artifactId}`.
- Uploads stream `request.body` directly into `R2.put()`.
- Downloads stream `R2.get().body` directly to the client.
- `HEAD` uses `R2.head()`.
- Optional KV artifact storage is available with `ARTIFACT_STORE=kv` and `ARTIFACTS_KV`, capped by KV's 25 MiB value limit.
- Turbo metadata is stored with the selected artifact store and returned as headers.
- Optional signature policy can require signed Turbo artifact metadata.
- Optional branch-aware cache policies can isolate PR branches or make PR writes read-only.
- Static bearer auth supports one token or a comma-separated token allowlist.
- Optional scoped static tokens restrict tokens to read/write scopes and team keys.
- `slug`, `teamId`, and `team` query selectors are accepted for compatibility with existing cache servers.
- Batch lookup is bounded and throttled to avoid unbounded R2 fanout.
- Read-only mode rejects uploads while preserving read/status/event compatibility.
- Optional Cache API reads are available after auth with synthetic artifact keys.
- Optional Analytics Engine metrics are emitted without blocking cache requests.
- Optional Rate Limiting binding enforcement keys limits by team and token.
- Optional D1 artifact indexing records upload metadata for larger installations.
- Scheduled cleanup can remove expired artifacts under the versioned key prefix.
- Branch artifacts can use shorter retention than mainline artifacts.
- `/internal/*` routes are separated from Turbo bearer auth and protected by a dedicated internal admin token.
- Lightweight `/v2/user`, `/v2/teams`, and `/v2/teams/:id` compatibility routes support Turbo user/team discovery with existing bearer tokens.

For multi-tenant deployments, prefer scoped static tokens or D1-backed hashed tokens over global static tokens. `/internal/*` administration is protected separately with `INTERNAL_ADMIN_TOKEN`.

## Development

```sh
pnpm install
pnpm --filter @turboflare/cache-worker dev
pnpm check
```

Useful test commands:

```sh
pnpm test
pnpm test:integration
pnpm --filter @turboflare/cache-worker exec vitest run test/index.test.ts
pnpm --filter @turboflare/cache-worker test:integration
```

`pnpm test:integration` runs a real `turbo run build` fixture against a local HTTP server backed by the Worker handler and in-memory R2. It verifies that the first run uploads to remote cache and the second run restores a remote cache hit.

Set `TURBO_TOKEN` on the Worker to one token or a comma-separated token allowlist. Turborepo sends it as `Authorization: Bearer <token>`.

For team-scoped static tokens, set `TURBO_TOKEN_SCOPES` to a JSON array:

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

Use `TURBO_TOKEN` for simple single-tenant deployments. Use `TURBO_TOKEN_SCOPES` when one Worker serves more than one team.

## Signatures and Branch Policies

Turbo can sign remote cache artifacts with `TURBO_REMOTE_CACHE_SIGNATURE_KEY` and `remoteCache.signature=true` in `turbo.json`. Turboflare preserves `x-artifact-tag` and can require it on uploads:

```txt
SIGNATURE_POLICY=off|accept|monitor|require
```

Branch-aware cache policy is optional and disabled by default:

```txt
BRANCH_CACHE_POLICY=shared|isolated|main-write-pr-read|read-only-pr
DEFAULT_BRANCH=main
BRANCH_RETENTION_DAYS=7
```

Branch names can be supplied with `?branch=<name>`, `x-turboflare-branch`, or stock Turbo team slugs using `TURBO_TEAM=team@branch`. Branch keys use `v1/team/{teamKey}/branch/{branch}/artifact/{artifactId}`. Existing default keys remain `v1/team/{teamKey}/artifact/{artifactId}`.

Policy behavior:

- `shared` keeps current key behavior.
- `isolated` stores each branch in its own namespace.
- `main-write-pr-read` writes non-default branches to branch namespaces and falls back to main artifacts on reads.
- `read-only-pr` lets non-default branches read main artifacts but rejects writes.

## Artifact Storage

R2 is the default and recommended artifact store. It supports the streaming hot path and large binary artifacts:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "ARTIFACTS",
      "bucket_name": "turboflare-artifacts"
    }
  ]
}
```

Configure R2 lifecycle rules for the same versioned prefix used by Turboflare:

```sh
pnpm r2:lifecycle:dry-run
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... pnpm r2:lifecycle
```

The lifecycle setup deletes objects under `v1/` after `RETENTION_DAYS` and aborts stale multipart uploads after `ABORT_MULTIPART_DAYS` days. `RETENTION_DAYS` defaults to the Worker value in `apps/cache-worker/wrangler.jsonc`; `ABORT_MULTIPART_DAYS` defaults to `1`.

KV artifact storage is optional for deployments that need it. Enable it explicitly:

```jsonc
{
  "vars": {
    "ARTIFACT_STORE": "kv"
  },
  "kv_namespaces": [
    {
      "binding": "ARTIFACTS_KV",
      "id": "<namespace-id>"
    }
  ]
}
```

KV mode stores the same `v1/team/{teamKey}/artifact/{artifactId}` keys, but it cannot preserve the R2 streaming upload path because KV writes require the Worker to materialize the artifact body. KV values are capped at 25 MiB, and Turboflare rejects larger KV uploads. Keep R2 as the default for normal Turborepo caches.

For hashed D1-backed tokens, bind `TOKEN_DB` and apply `apps/cache-worker/schema/001_tokens.sql`. `token_hash` is the lowercase hex SHA-256 of the raw token. `teams` and `scopes` are JSON arrays, for example `teams = ["team_turboflare"]` and `scopes = ["read", "write"]`.

For optional artifact indexing, bind `ARTIFACT_INDEX` and apply `apps/cache-worker/schema/002_artifact_index.sql`. Index writes run after R2 upload via `ctx.waitUntil()` and are not required for cache correctness.

Internal token admin routes are available when `TOKEN_DB` is bound:

- `GET /internal/tokens` lists token metadata without hashes.
- `POST /internal/tokens` creates a token from `{ "teams": ["team_turboflare"], "scopes": ["read", "write"] }` and returns the raw token once.
- `POST /internal/tokens/:id/revoke` marks a token revoked without deleting its audit row.

Internal artifact admin routes are also available:

- `POST /internal/artifacts/purge-expired` runs the same bounded retention cleanup as the scheduled Worker.

## Observability

When `ANALYTICS` is bound, Turboflare writes one Analytics Engine datapoint per status, preflight, upload, hit, miss, and event request. The tenant is the index; blobs include event type, method, tenant, sampled artifact ID, and token ID; doubles include status, bytes, and timestamp.

Optional Worker variables and bindings:

- `CACHE_API_READS=true` enables authenticated Cache API reads with synthetic artifact keys.
- `CACHE_API_MAX_BYTES` controls the largest artifact eligible for Cache API fill. The default is `10485760`.
- `MAX_ARTIFACT_BYTES` optionally rejects oversized uploads before R2 writes when `Content-Length` is present.
- `ARTIFACT_STORE=kv` switches artifact bytes to KV. Omit it or set `r2` to use R2.
- `ARTIFACTS_KV` is required only when `ARTIFACT_STORE=kv`.
- `ANALYTICS` can be bound to Analytics Engine for non-blocking request metrics.
- `RATE_LIMITER` can be bound to Cloudflare Workers Rate Limiting. It is enforced after auth with keys shaped as `team:{teamKey}:token:{tokenId}`.
- `INTERNAL_ADMIN_TOKEN` protects `/internal/*` and is separate from `TURBO_TOKEN`.
- `RETENTION_DAYS` controls scheduled R2 artifact cleanup. The default is `30`.
- `BRANCH_RETENTION_DAYS` controls scheduled cleanup for branch namespace artifacts. It defaults to `RETENTION_DAYS`.
- `CLEANUP_MAX_DELETE` caps scheduled deletions per run. The default is `1000`.
- `ABORT_MULTIPART_DAYS` controls the R2 lifecycle rule for stale multipart uploads when running `pnpm r2:lifecycle`. The default is `1`.

## Prune Smoke

Verify a pruned Docker workspace can write and then read remote cache:

```sh
PRUNE_CWD=fixtures/complex-turbo-monorepo TURBO_API=... TURBO_TOKEN=... TURBO_TEAM=prune-smoke pnpm prune:smoke web
```

`.github/workflows/prune-smoke.yml` is included as an optional manual smoke test.

Use R2 `Standard` storage for cache artifacts. Turborepo cache artifacts are usually hot and short-lived, so Infrequent Access is not the default.

## Deployment

### One-Click Deploy

Use the button at the top of this README to deploy from GitHub. The root `deploy` script creates the configured R2 bucket if it does not exist, then deploys the Worker from `apps/cache-worker/wrangler.jsonc`.

After deployment, set at least one Turbo bearer token as a Worker secret:

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Set `INTERNAL_ADMIN_TOKEN` only if you want to use `/internal/*` admin routes:

```sh
wrangler secret put INTERNAL_ADMIN_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Point Turborepo at your deployed Worker:

```sh
export TURBO_API="https://<worker-name>.<subdomain>.workers.dev"
export TURBO_TOKEN="<same token>"
export TURBO_TEAM="team-name"
turbo run build
```

Minimal Worker deployment:

```sh
pnpm deploy
```

Apply optional D1 schema files only for the features you bind:

```sh
wrangler d1 execute <token-db-name> --file apps/cache-worker/schema/001_tokens.sql
wrangler d1 execute <artifact-index-db-name> --file apps/cache-worker/schema/002_artifact_index.sql
```

Optionally apply R2 lifecycle rules after deployment:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... pnpm r2:lifecycle
```

Expose `/v8/*` publicly behind Turbo bearer auth. Keep `/internal/*` private and set a separate `INTERNAL_ADMIN_TOKEN`; internal routes fail closed when it is missing.
