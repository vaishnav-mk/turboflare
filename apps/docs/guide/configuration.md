# Configuration

Turboflare is useful with only R2 and one bearer token. Everything else is optional.

## Required

| Name          | Type       | Purpose                                  |
| ------------- | ---------- | ---------------------------------------- |
| `ARTIFACTS`   | R2 binding | durable artifact storage                 |
| `TURBO_TOKEN` | secret     | bearer token accepted from Turbo clients |

Default R2 binding:

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

## Common variables

| Name                    | Values                                                     | Default          | Purpose                                  |
| ----------------------- | ---------------------------------------------------------- | ---------------- | ---------------------------------------- |
| `CACHE_STATUS`          | `enabled`, `disabled`, `over_limit`, `paused`              | `enabled`        | status response                          |
| `READ_ONLY`             | `true`, `false`                                            | `false`          | reject writes while allowing reads       |
| `SIGNATURE_POLICY`      | `off`, `accept`, `monitor`, `require`                      | `off`            | preserve or require Turbo signature tags |
| `BRANCH_CACHE_POLICY`   | `shared`, `isolated`, `main-write-pr-read`, `read-only-pr` | `shared`         | branch cache behavior                    |
| `DEFAULT_BRANCH`        | branch name                                                | `main`           | mainline branch for branch policies      |
| `RETENTION_DAYS`        | number                                                     | `30`             | Worker cleanup and lifecycle default     |
| `BRANCH_RETENTION_DAYS` | number                                                     | `RETENTION_DAYS` | shorter branch cleanup                   |
| `CLEANUP_MAX_DELETE`    | number                                                     | `1000`           | max deletes per scheduled cleanup        |
| `MAX_ARTIFACT_BYTES`    | bytes                                                      | `524288000`      | upload cap when `Content-Length` exists  |
| `CACHE_API_READS`       | `true`, `false`                                            | `false`          | fill Cloudflare Cache API after R2 reads |
| `CACHE_API_MAX_BYTES`   | bytes                                                      | `10485760`       | largest Cache API-eligible artifact      |
| `ARTIFACT_STORE`        | `r2`, `kv`                                                 | `r2`             | choose R2 or KV artifact store           |

## Optional bindings

| Binding          | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `TOKEN_DB`       | D1 hashed tokens and token admin APIs      |
| `ARTIFACT_INDEX` | D1 artifact metadata index                 |
| `ANALYTICS`      | Analytics Engine metrics                   |
| `RATE_LIMITER`   | Cloudflare Rate Limiting binding           |
| `ARTIFACTS_KV`   | KV artifact store when `ARTIFACT_STORE=kv` |

These bindings are independent. The smallest production setup is still just `ARTIFACTS` plus `TURBO_TOKEN`.

| Binding          | Source of truth?       | Why it exists                                                                                |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `ARTIFACTS`      | yes                    | stores artifact bodies and metadata in R2                                                    |
| `ARTIFACTS_KV`   | yes, only in KV mode   | explicit small-artifact fallback when `ARTIFACT_STORE=kv`                                    |
| `TOKEN_DB`       | yes for dynamic tokens | stores hashed tokens, scopes, teams, expiration, and revocation state                        |
| `ARTIFACT_INDEX` | no                     | queryable D1 metadata for admin/search/reporting; uploads still succeed if index writes fail |
| `ANALYTICS`      | no                     | append-only metrics for traffic, hits, misses, bytes, tenants, and tokens                    |
| `RATE_LIMITER`   | no                     | optional request guardrail for hosted or multi-tenant deployments                            |

## Routes

| Route                  | Method | Auth           | Purpose             |
| ---------------------- | ------ | -------------- | ------------------- |
| `/management/health`   | `GET`  | none           | public health check |
| `/v8/artifacts/status` | `GET`  | Turbo token    | cache status        |
| `/v8/artifacts/:id`    | `PUT`  | write scope    | upload artifact     |
| `/v8/artifacts/:id`    | `GET`  | read scope     | download artifact   |
| `/v8/artifacts/:id`    | `HEAD` | read scope     | metadata lookup     |
| `/v8/artifacts`        | `POST` | read scope     | batch lookup        |
| `/v8/artifacts/events` | `POST` | read scope     | hit/miss events     |
| `/v2/user`             | `GET`  | Turbo token    | Turbo compatibility |
| `/v2/teams`            | `GET`  | Turbo token    | Turbo compatibility |
| `/internal/*`          | mixed  | internal token | admin operations    |

## Cloudflare Pages or Workers Builds

The docs app is static. The cache server is a Worker. Keep them deployed separately:

| App                 | Deploy target                       |
| ------------------- | ----------------------------------- |
| `apps/cache-worker` | Cloudflare Workers                  |
| `apps/docs`         | Cloudflare Pages or any static host |

Build docs with:

```sh
pnpm --filter @turboflare/docs build
```

Output is `apps/docs/dist`.
