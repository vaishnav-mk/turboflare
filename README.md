# Turboflare

Turboflare is a speed-first, Cloudflare-native remote cache for Turborepo.

It is designed to be compatible with Turborepo's `/v8/artifacts` remote cache protocol while using Cloudflare Workers, R2, Cache API, Durable Objects, Analytics Engine, Rate Limiting, Access, and optionally Cloudflare Artifacts.

## Goal

Be the best self-hostable Turborepo remote cache for teams that want Cloudflare-native performance, control, observability, and enterprise operations.

## Current Status

Initial Worker implementation exists. The current app provides the basic Turborepo `/v8/artifacts` protocol on Workers and R2:

- `GET /v8/artifacts/status`
- `PUT /v8/artifacts/:artifactId`
- `GET /v8/artifacts/:artifactId`
- `HEAD /v8/artifacts/:artifactId`
- `POST /v8/artifacts`
- `POST /v8/artifacts/events`
- `OPTIONS /v8/artifacts/*`
- `GET /management/health`

The hot path is intentionally hand-written and small: bearer auth, tenant normalization, versioned R2 key construction, R2 `head`/`get`/`put`, and response header preservation. Hono/OpenAPI-style machinery is reserved for later `/internal/*` control-plane APIs.

Current implementation details:

- R2 object keys use `v1/team/{teamKey}/artifact/{artifactId}`.
- Uploads stream `request.body` directly into `R2.put()`.
- Downloads stream `R2.get().body` directly to the client.
- `HEAD` uses `R2.head()`.
- Turbo metadata is stored in R2 `customMetadata` and returned as headers.
- Static bearer auth supports one token or a comma-separated token allowlist.
- Optional scoped static tokens restrict tokens to read/write scopes and team keys.
- `slug`, `teamId`, and `team` query selectors are accepted for compatibility with existing cache servers.
- Batch lookup is bounded and throttled to avoid unbounded R2 fanout.
- Read-only mode rejects uploads while preserving read/status/event compatibility.
- Optional Cache API reads are available after auth with synthetic artifact keys.
- Optional Analytics Engine metrics are emitted without blocking cache requests.
- Scheduled R2 cleanup can remove expired artifacts under the versioned key prefix.
- `/internal/*` routes are separated from Turbo bearer auth and protected by Cloudflare Access JWT verification.

Local research and planning docs live under `docs/` and are intentionally ignored until they are ready to publish.

## Reference Findings

The current baseline was shaped by three deeper references:

- `brunojppb/turbo-cache-server`: copy the tiny stateless streaming model, public health endpoint, and boring S3/R2-style hot path.
- `ducktors/turborepo-remote-cache`: copy `teamId`/`team`/`slug` compatibility, read-only mode, and future JWT/JWKS ideas; avoid buffered uploads and separate `.tag` objects.
- `Tapico/tapico-turborepo-remote-cache`: copy comma-separated token rotation; avoid bucket-per-team, per-request storage setup, and secret logging.

The main known gap is tenant-scoped authorization. Static tokens are global today; enterprise mode should add D1/JWT/Access-backed token-to-team scoping before multi-tenant use.

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

For hashed D1-backed tokens, bind `TOKEN_DB` and create a `tokens` table with these columns:

```sql
create table tokens (
  id text primary key,
  token_hash text not null unique,
  teams text not null,
  scopes text not null,
  expires_at text,
  revoked_at text
);
```

`token_hash` is the lowercase hex SHA-256 of the raw token. `teams` and `scopes` are JSON arrays, for example `teams = ["team_turboflare"]` and `scopes = ["read", "write"]`.

Optional Worker variables and bindings:

- `CACHE_API_READS=true` enables authenticated Cache API reads with synthetic artifact keys.
- `CACHE_API_MAX_BYTES` controls the largest artifact eligible for Cache API fill. The default is `10485760`.
- `ANALYTICS` can be bound to Analytics Engine for non-blocking request metrics.
- `INTERNAL_ACCESS_BYPASS=true` allows `/internal/*` routes in local tests only. Do not use it for public deployments.
- `INTERNAL_ACCESS_TEAM_DOMAIN` is your Access team domain, for example `https://example.cloudflareaccess.com`.
- `INTERNAL_ACCESS_AUD` is the Access application audience tag. Comma-separated values are accepted.
- `INTERNAL_ACCESS_JWKS_URL` optionally overrides the Access certs URL.
- `INTERNAL_ACCESS_JWKS` optionally provides the Access JWKS JSON directly for tests or offline deployments.
- `RETENTION_DAYS` controls scheduled R2 artifact cleanup. The default is `30`.
- `CLEANUP_MAX_DELETE` caps scheduled deletions per run. The default is `1000`.

## Next Milestones

- Add `/internal/*` token creation, listing, and revocation APIs.
- Add purge-expired admin route in addition to scheduled cleanup.
- Add per-team quota and rate-limit enforcement.
- Add optional indexed metadata mode for larger installations.
- Polish deployment templates and login/link compatibility.
