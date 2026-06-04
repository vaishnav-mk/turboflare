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
- `slug`, `teamId`, and `team` query selectors are accepted for compatibility with existing cache servers.
- Batch lookup is bounded and throttled to avoid unbounded R2 fanout.
- Read-only mode rejects uploads while preserving read/status/event compatibility.

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

Set `TURBO_TOKEN` on the Worker to one token or a comma-separated token allowlist. Turborepo sends it as `Authorization: Bearer <token>`.

## Next Milestones

- Add real Turborepo fixture tests using `TURBO_API`, `TURBO_TOKEN`, `TURBO_TEAM`, and `TURBO_TEAMID`.
- Add tenant-scoped token authorization for multi-team deployments.
- Add optional Cache API acceleration after auth with synthetic cache keys.
- Add `/internal/*` Access-protected admin routes for stats, purge, and token management.
