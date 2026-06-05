# Turboflare

Turboflare is a speed-first, Cloudflare-native remote cache for Turborepo.

It is designed to be compatible with Turborepo's `/v8/artifacts` remote cache protocol while using Cloudflare Workers, R2, Cache API, Analytics Engine, Rate Limiting, Access, and optional KV artifact storage.

## Goal

Be the best self-hostable Turborepo remote cache for teams that want Cloudflare-native performance, control, observability, and enterprise operations.

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
- `/internal/*` routes are separated from Turbo bearer auth and protected by Cloudflare Access JWT verification.
- Lightweight `/v2/user`, `/v2/teams`, and `/v2/teams/:id` compatibility routes support Turbo user/team discovery with existing bearer tokens.

## Reference Findings

The current baseline was shaped by three deeper references:

- `brunojppb/turbo-cache-server`: validated a tiny stateless streaming model, public health endpoint, and S3/R2-style hot path.
- `ducktors/turborepo-remote-cache`: informed `teamId`/`team`/`slug` compatibility, read-only mode, and future JWT/JWKS considerations.
- `Tapico/tapico-turborepo-remote-cache`: informed comma-separated token rotation and reinforced avoiding bucket-per-team, per-request storage setup, and secret logging.

For multi-tenant deployments, prefer scoped static tokens or D1-backed hashed tokens over global static tokens. `/internal/*` administration is protected separately with Cloudflare Access JWT verification.

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

Tracked SQL setup files are available under `apps/cache-worker/schema/`.

For optional artifact indexing, bind `ARTIFACT_INDEX` and create this table:

```sql
create table artifact_index (
  object_key text primary key,
  team text not null,
  artifact_id text not null,
  size integer not null,
  duration_ms integer not null,
  tag text,
  sha text,
  dirty_hash text,
  token_id text not null,
  created_at text not null,
  updated_at text not null
);

create index artifact_index_team on artifact_index(team);
```

Index writes run after R2 upload via `ctx.waitUntil()` and are not required for cache correctness.

Access-protected token admin routes are available when `TOKEN_DB` is bound:

- `GET /internal/tokens` lists token metadata without hashes.
- `POST /internal/tokens` creates a token from `{ "teams": ["team_turboflare"], "scopes": ["read", "write"] }` and returns the raw token once.
- `POST /internal/tokens/:id/revoke` marks a token revoked without deleting its audit row.

Access-protected artifact admin routes are also available:

- `POST /internal/artifacts/purge-expired` runs the same bounded retention cleanup as the scheduled Worker.

## Observability

When `ANALYTICS` is bound, Turboflare writes one Analytics Engine datapoint per status, preflight, upload, hit, miss, and event request. The tenant is the index; blobs include event type, method, tenant, sampled artifact ID, and token ID; doubles include status, bytes, and timestamp.

Example dashboard queries:

```sql
-- Remote hit ratio by team.
select
  index1 as team,
  countIf(blob1 = 'get_hit') / nullIf(countIf(blob1 in ('get_hit', 'get_miss')), 0) as hit_ratio
from turboflare_metrics
where timestamp > now() - interval '1' day
group by team;

-- Upload status distribution.
select blob3 as team, double1 as status, count() as requests
from turboflare_metrics
where blob1 = 'put' and timestamp > now() - interval '1' day
group by team, status;

-- Preflight volume.
select blob3 as team, count() as preflights
from turboflare_metrics
where blob1 = 'preflight' and timestamp > now() - interval '1' day
group by team;

-- Bytes served by cache hits.
select blob3 as team, sum(double2) as bytes
from turboflare_metrics
where blob1 in ('get_hit', 'head_hit') and timestamp > now() - interval '1' day
group by team;
```

Optional Worker variables and bindings:

- `CACHE_API_READS=true` enables authenticated Cache API reads with synthetic artifact keys.
- `CACHE_API_MAX_BYTES` controls the largest artifact eligible for Cache API fill. The default is `10485760`.
- `MAX_ARTIFACT_BYTES` optionally rejects oversized uploads before R2 writes when `Content-Length` is present.
- `ARTIFACT_STORE=kv` switches artifact bytes to KV. Omit it or set `r2` to use R2.
- `ARTIFACTS_KV` is required only when `ARTIFACT_STORE=kv`.
- `ANALYTICS` can be bound to Analytics Engine for non-blocking request metrics.
- `RATE_LIMITER` can be bound to Cloudflare Workers Rate Limiting. It is enforced after auth with keys shaped as `team:{teamKey}:token:{tokenId}`.
- `INTERNAL_ACCESS_BYPASS=true` allows `/internal/*` routes in local tests only. Do not use it for public deployments.
- `INTERNAL_ACCESS_TEAM_DOMAIN` is your Access team domain, for example `https://example.cloudflareaccess.com`.
- `INTERNAL_ACCESS_AUD` is the Access application audience tag. Comma-separated values are accepted.
- `INTERNAL_ACCESS_JWKS_URL` optionally overrides the Access certs URL.
- `INTERNAL_ACCESS_JWKS` optionally provides the Access JWKS JSON directly for tests or offline deployments.
- `RETENTION_DAYS` controls scheduled R2 artifact cleanup. The default is `30`.
- `CLEANUP_MAX_DELETE` caps scheduled deletions per run. The default is `1000`.

Use R2 `Standard` storage for cache artifacts. Infrequent Access is not the default because Turborepo cache artifacts are hot and often short-lived.

R2 custom-domain CDN caching is a separate public-bucket mode, not the default authenticated Worker path. If you use it, configure public access, WAF or equivalent access controls, explicit Cache Rules for non-default file types, and object-size behavior deliberately.

Client-side `TURBO_REMOTE_CACHE_READ_ONLY` is separate from server-side read-only mode. Server-side read-only mode rejects uploads for every client; client-side read-only mode controls whether a given Turbo invocation writes remote artifacts.

R2 event notifications are optional. If you use them for audit or index repair, handlers should be idempotent because object lifecycle cleanup and manual purges can race with notification delivery.

## Deployment

Minimal Worker deployment:

```sh
pnpm --filter @turboflare/cache-worker run deploy
```

Apply optional D1 schema files only for the features you bind:

```sh
wrangler d1 execute <token-db-name> --file apps/cache-worker/schema/001_tokens.sql
wrangler d1 execute <artifact-index-db-name> --file apps/cache-worker/schema/002_artifact_index.sql
```

Set secrets out of band:

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Turbo client environment:

```sh
export TURBO_API="https://cache.example.com"
export TURBO_TOKEN="..."
export TURBO_TEAM="team-name"
turbo run build
```

GitHub Actions example:

```yaml
env:
  TURBO_API: https://cache.example.com
  TURBO_TEAM: team-name
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}

steps:
  - uses: actions/checkout@v6
  - uses: pnpm/action-setup@v6
    with:
      version: 11.5.0
  - uses: actions/setup-node@v6
    with:
      node-version: 24
      cache: pnpm
  - run: pnpm install --frozen-lockfile
  - run: pnpm build
```

GitLab CI example:

```yaml
variables:
  TURBO_API: https://cache.example.com
  TURBO_TEAM: team-name
  TURBO_TOKEN: $TURBO_TOKEN

build:
  image: node:24
  script:
    - corepack enable
    - pnpm install --frozen-lockfile
    - pnpm build
```

Expose `/v8/*` publicly behind bearer auth. Keep `/internal/*` behind Cloudflare Access with `INTERNAL_ACCESS_TEAM_DOMAIN` and `INTERNAL_ACCESS_AUD` configured.

## V1 Scope

Turboflare v1 uses environment tokens and internal token APIs instead of implementing the full OAuth `turbo login` device flow. It implements lightweight `/v2/user` and `/v2/teams` metadata for compatibility, but token issuance remains explicit through static secrets or Access-protected internal APIs.

Temporary R2 S3 credential issuance, Terraform modules, and OTEL exporters are intentionally outside the stock `/v8` cache path. Add them as separate control-plane features only if a deployment needs them.

## Operational Follow-Ups

- Create production D1 databases and apply `apps/cache-worker/schema/*.sql` when using `TOKEN_DB` or `ARTIFACT_INDEX`.
- Configure a custom domain if relying on Cache API reads in production.
- Set `INTERNAL_ACCESS_TEAM_DOMAIN` and `INTERNAL_ACCESS_AUD` before exposing `/internal/*` routes.
- Bind `RATE_LIMITER`, `ANALYTICS`, `TOKEN_DB`, or `ARTIFACT_INDEX` only when those features are needed.
