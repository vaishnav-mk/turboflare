# Feature Matrix

Turboflare is alpha. These are implemented features only, checked against Turboflare's Worker code and Turborepo's remote-cache client behavior.

## Turbo Client Compatibility

| Feature                  | Enabled by                                                         | Notes                                                                                                     |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Custom cache API URL     | `TURBO_API` or Turbo `remoteCache.apiUrl`                          | Use the Worker origin only. Do not append protocol paths. See [Turbo Client Setup](/guide/turbo-client/). |
| Remote cache enable flag | Turbo `remoteCache.enabled`                                        | If `false`, Turbo will not call Turboflare. See [Getting Started](/guide/getting-started/).               |
| Preflight mode           | Turbo `remoteCache.preflight`                                      | Turboflare supports `OPTIONS /v8/*` with auth headers. See [API Reference](/reference/api/).              |
| Signed cache mode        | Turbo `remoteCache.signature` + `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | Turbo signs uploads and verifies downloads. Turboflare stores the tag and can require it.                 |
| Team slug selector       | `TURBO_TEAM` / query `slug`                                        | Turbo sends team slug as `slug`. See [Auth & Teams](/guide/auth-teams/).                                  |
| Team id selector         | `TURBO_TEAMID` / query `teamId`                                    | Turbo sends `teamId` when configured and it starts with `team_`.                                          |
| Cache operation timeouts | Turbo `remoteCache.timeout`, `remoteCache.uploadTimeout`           | Client-side behavior; Turboflare just needs to answer within those limits.                                |

## Turbo Protocol

| Feature               | Enabled by | Notes                                                                       |
| --------------------- | ---------- | --------------------------------------------------------------------------- |
| Artifact status       | default    | `GET /v8/artifacts/status` returns cache status.                            |
| Artifact upload       | default    | `PUT /v8/artifacts/:id`, write scope required.                              |
| Artifact download     | default    | `GET /v8/artifacts/:id`, read scope required.                               |
| Metadata-only lookup  | default    | `HEAD /v8/artifacts/:id` returns metadata headers without body.             |
| Batch lookup          | default    | `POST /v8/artifacts` accepts `hashes`.                                      |
| Hit/miss events       | default    | `POST /v8/artifacts/events`; `GET` returns empty history for compatibility. |
| CORS/preflight        | default    | `OPTIONS /v8/*` returns Turbo-compatible preflight headers.                 |
| Turbo identity routes | default    | `/v2/user`, `/v2/teams`, and `/v2/teams/:id`.                               |

See [API Reference](/reference/api/) for exact route shapes.

## Storage And Retention

| Feature               | Enabled by                           | Notes                                                                          |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| R2 artifact store     | `ARTIFACTS` binding                  | Default source of truth. See [Storage & Retention](/guide/storage-retention/). |
| KV artifact store     | `ARTIFACT_STORE=kv` + `ARTIFACTS_KV` | Small-artifact fallback; 25 MiB KV value cap.                                  |
| Upload size cap       | `MAX_ARTIFACT_BYTES`                 | Defaults to 500 MiB; no-length uploads are bounded.                            |
| Versioned object keys | default                              | Keys use `v1/team/...`; branch keys add `/branch/...`.                         |
| R2 lifecycle helper   | `pnpm r2:lifecycle`                  | Applies bucket lifecycle rules through Cloudflare API.                         |
| Scheduled cleanup     | optional cron in `wrangler.jsonc`    | Deletes expired stored artifacts up to `CLEANUP_MAX_DELETE`.                   |
| Manual expired purge  | `INTERNAL_ADMIN_TOKEN`               | `POST /internal/artifacts/purge-expired`.                                      |

## Auth And Tenancy

| Feature                | Enabled by               | Notes                                                                |
| ---------------------- | ------------------------ | -------------------------------------------------------------------- |
| Single static token    | `TURBO_TOKEN`            | Smallest setup; bearer auth. See [Auth & Teams](/guide/auth-teams/). |
| Static token allowlist | `TURBO_TOKEN` comma list | Multiple accepted bearer tokens.                                     |
| Scoped static tokens   | `TURBO_TOKEN_SCOPES`     | JSON rules for token id, teams, and read/write scopes.               |
| D1 token database      | `TOKEN_DB` binding       | Hashed tokens, expiration, revocation, team/scope rules, audit rows. |
| Internal admin token   | `INTERNAL_ADMIN_TOKEN`   | Required for `/internal/*`; missing config fails closed.             |
| Team selectors         | default                  | Uses `slug`, `teamId`, `team`, or fallback `global`.                 |
| Team access checks     | scoped tokens/D1 tokens  | Resolved team must be allowed by token.                              |

## Branches And Signatures

| Feature                     | Enabled by                               | Notes                                                          |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Shared branch policy        | default                                  | Maximum reuse; no branch namespace.                            |
| Isolated branch policy      | `BRANCH_CACHE_POLICY=isolated`           | Separate branch namespaces.                                    |
| Main fallback policy        | `BRANCH_CACHE_POLICY=main-write-pr-read` | Branch reads can fall back to main.                            |
| Read-only PR policy         | `BRANCH_CACHE_POLICY=read-only-pr`       | Non-default branch writes are rejected.                        |
| Branch selectors            | branch policy enabled                    | Supports `?branch=`, `x-turboflare-branch`, and `team@branch`. |
| Signature metadata preserve | `SIGNATURE_POLICY=accept`                | Stores Turbo signature tag when present.                       |
| Signature monitoring        | `SIGNATURE_POLICY=monitor` + `ANALYTICS` | Emits metric when upload lacks signature tag.                  |
| Require signature tag       | `SIGNATURE_POLICY=require`               | Rejects uploads missing `x-artifact-tag`.                      |

See [Branches & Signatures](/guide/branches-signatures/).

## Ops And Protection

| Feature                 | Enabled by                          | Notes                                                                   |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| Read-only mode          | `READ_ONLY=true`                    | Rejects uploads while reads/status/events still work.                   |
| Cache API read fill     | `CACHE_API_READS=true`              | Optional read acceleration up to `CACHE_API_MAX_BYTES`.                 |
| Analytics Engine writes | `ANALYTICS` binding                 | Non-blocking datapoints for traffic, hits, misses, uploads, and events. |
| Metrics summary API     | analytics query vars                | `GET /internal/metrics/summary` supports `15m`, `1h`, `6h`, `24h`.      |
| Rate limiting           | `RATE_LIMITER` binding              | Per-token or per-team/token guardrail.                                  |
| Internal health         | `INTERNAL_ADMIN_TOKEN`              | `GET /internal/health`.                                                 |
| Team stats              | `INTERNAL_ADMIN_TOKEN`              | `GET /internal/teams/:team/stats`.                                      |
| Team purge              | `INTERNAL_ADMIN_TOKEN`              | `POST /internal/teams/:team/purge-all`.                                 |
| Token admin APIs        | `INTERNAL_ADMIN_TOKEN` + `TOKEN_DB` | List, create, and revoke D1 tokens.                                     |
| Artifact metadata index | `ARTIFACT_INDEX` binding            | D1 rows for admin/search/reporting; not source of truth.                |

See [Operations](/guide/operations/).

## Deployment And Testing

| Feature                      | Enabled by                   | Notes                                                                                |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| Clone-free installer         | `pnpm dlx create-turboflare` | Guided deploy, secret setup, smoke checks, optional Turbo verification.              |
| Source-checkout setup        | `pnpm setup`                 | Guided setup for contributors/custom deployments.                                    |
| Root deploy helper           | `pnpm deploy`                | Creates configured R2 bucket if missing, then deploys Worker.                        |
| Deploy Button support        | root `wrangler.jsonc`        | Cloudflare Deploy Button can install/deploy from repo root.                          |
| Unit tests                   | `pnpm test`                  | Worker route/auth/storage behavior.                                                  |
| Real Turbo integration tests | `pnpm test:integration`      | Stock Turbo fixture verifies remote cache restore.                                   |
| Pruned workspace smoke       | `pnpm prune:smoke`           | Remote cache behavior inside pruned fixture workspace.                               |
| Agentic setup guide          | docs page + setup skill      | Safe prompt/checklist for coding agents. See [Agentic Setup](/guide/agentic-setup/). |

## Not Included

| Item                           | Status                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| `turbo login` token minting    | Not implemented; configure `TURBO_TOKEN` manually or through the installer. |
| Vercel account/team management | Not implemented; `/v2/*` routes return compatibility metadata only.         |

Missing something? Open a [feature request](https://github.com/vaishnav-mk/turboflare/issues/new?labels=enhancement) or DM [@wishee0](https://x.com/wishee0).
