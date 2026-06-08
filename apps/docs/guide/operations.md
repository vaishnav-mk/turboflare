# Operations

This page covers production knobs, admin routes, observability, and troubleshooting.

## Production checklist

| Area           | Recommendation                                          |
| -------------- | ------------------------------------------------------- |
| artifact store | use R2 default                                          |
| token          | set `TURBO_TOKEN`, scoped tokens, or D1 tokens          |
| internal admin | set `INTERNAL_ADMIN_TOKEN` only if using `/internal/*`  |
| retention      | apply R2 lifecycle                                      |
| signatures     | use `SIGNATURE_POLICY=require` for stricter CI          |
| branch policy  | keep `shared` unless PR isolation is needed             |
| observability  | keep Worker observability enabled                       |
| rate limits    | bind `RATE_LIMITER` for hosted/multi-tenant deployments |

## Internal routes

All `/internal/*` routes require `INTERNAL_ADMIN_TOKEN`.

| Route                               | Method | Purpose                        |
| ----------------------------------- | ------ | ------------------------------ |
| `/internal/health`                  | `GET`  | internal health check          |
| `/internal/teams/:team/stats`       | `GET`  | object count and total bytes   |
| `/internal/teams/:team/purge-all`   | `POST` | delete artifacts for one team  |
| `/internal/artifacts/purge-expired` | `POST` | run cleanup immediately        |
| `/internal/metrics/summary`         | `GET`  | Analytics Engine usage summary |
| `/internal/tokens`                  | `GET`  | list D1 tokens                 |
| `/internal/tokens`                  | `POST` | create D1 token                |
| `/internal/tokens/:id/revoke`       | `POST` | revoke D1 token                |

## Artifact index

Bind `ARTIFACT_INDEX` if you want D1 rows for uploaded artifacts.

Apply schema:

```sh
wrangler d1 execute <artifact-index-db-name> --file apps/cache-worker/schema/002_artifact_index.sql
```

Index writes run after upload with `ctx.waitUntil()`. Upload correctness does not depend on index writes.

The artifact index is not the cache source of truth. It exists so operators can query metadata that is awkward to query from R2 object listings alone: object key, team, artifact id, size, duration, signature tag, git SHA, dirty hash, token id, and timestamps.

Use it when you want admin/search/reporting features. Skip it for the smallest Worker + R2 deployment.

## Analytics Engine

Bind `ANALYTICS` to record non-blocking datapoints for status, preflight, upload, hit, miss, and event requests.

Set these only if you want `/internal/metrics/summary` to query Analytics Engine from the Worker:

| Variable                | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | account that owns the Analytics Engine table |
| `ANALYTICS_DATASET`     | Analytics Engine dataset/table name          |
| `ANALYTICS_API_TOKEN`   | token with Account Analytics Read            |

Supported summary windows are `15m`, `1h`, `6h`, and `24h`. Missing query config returns `503`.

Metric shape:

| Field   | Contents                                         |
| ------- | ------------------------------------------------ |
| index   | tenant key                                       |
| blobs   | event, method, tenant, artifact sample, token id |
| doubles | status, bytes, timestamp                         |

Analytics Engine is append-only observability. It should not be used as the artifact inventory or token database.

## Rate limiting

Bind `RATE_LIMITER` to use Cloudflare Workers Rate Limiting.

Key shape:

```txt
team:{teamKey}:token:{tokenId}
```

Status requests without a tenant use:

```txt
token:{tokenId}
```

This is optional. It is most useful when one Turboflare deployment is shared across many teams or exposed to untrusted clients.

## Read-only mode

Set:

```txt
READ_ONLY=true
```

Uploads are rejected. Reads, status, events, and compatibility metadata still work.

## Prune smoke

Test remote cache behavior inside a pruned Docker-style workspace:

```sh
PRUNE_CWD=fixtures/complex-turbo-monorepo \
TURBO_API=... \
TURBO_TOKEN=... \
TURBO_TEAM=prune-smoke \
pnpm prune:smoke web
```

## Troubleshooting

| Symptom                         | Likely cause                                               | Fix                                                                     |
| ------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `401` on `/v8/artifacts/status` | missing/wrong bearer token                                 | set `TURBO_TOKEN` on Worker and client                                  |
| `403` on upload                 | token lacks write scope or team access                     | check scoped token teams/scopes                                         |
| `403` on branch writes          | `read-only-pr` policy                                      | use default branch or change policy                                     |
| no remote hits                  | different task hash, missing `TURBO_TEAM`, changed outputs | verify Turbo env and task outputs                                       |
| KV upload rejected              | artifact too large                                         | use R2 or smaller artifacts                                             |
| internal route `503`            | admin token or optional binding missing                    | configure `INTERNAL_ADMIN_TOKEN`, `TOKEN_DB`, or `ARTIFACT_INDEX`       |
| lifecycle script fails          | API token/account/bucket mismatch                          | check `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_BUCKET_NAME` |

## Local development

```sh
pnpm install
pnpm check
pnpm --filter @turboflare/cache-worker dev
```

Docs app:

```sh
pnpm --filter @turboflare/docs dev
pnpm --filter @turboflare/docs build
```
