# API Reference

Turboflare implements the Turbo remote cache protocol plus small compatibility and admin surfaces.

## Authentication

Turbo routes use:

```txt
Authorization: Bearer <TURBO_TOKEN>
```

`PUT /v8/artifacts/:artifactId` requires write scope. Status, lookup, events, `GET`, `HEAD`, and `/v2` compatibility routes require read scope. `OPTIONS /v8/*` is an unauthenticated CORS-style preflight and returns `204`.

Internal routes use:

```txt
Authorization: Bearer <INTERNAL_ADMIN_TOKEN>
```

Most JSON errors use this shape:

```json
{ "error": { "code": "bad_request", "message": "..." } }
```

Artifact `GET` and `HEAD` misses return empty `404` responses.

## Tenant selectors

Turbo routes resolve the cache namespace from query parameters in this order:

| Selector | Example            | Result              |
| -------- | ------------------ | ------------------- |
| `slug`   | `?slug=web`        | team key `web`      |
| `teamId` | `?teamId=team_abc` | team key `team_abc` |
| `team`   | `?team=web`        | team key `web`      |
| none     | no query           | team key `global`   |

Scoped tokens must include the resolved team key. When branch policy is enabled, `?branch=`, `x-turboflare-branch`, or `team@branch` can select a branch namespace. Branch values are client-supplied; use scoped/read-only tokens for trust boundaries.

## Turbo routes

### `GET /v8/artifacts/status`

Returns cache status.

```json
{ "status": "enabled" }
```

### `PUT /v8/artifacts/:artifactId`

Uploads one artifact.

If present, this header must be:

```txt
Content-Type: application/octet-stream
```

Returns:

```json
{ "urls": [] }
```

### `GET /v8/artifacts/:artifactId`

Downloads one artifact body.

Returns `404` on miss.

### `HEAD /v8/artifacts/:artifactId`

Returns artifact metadata headers without the body.

Returns empty `404` on miss.

Common headers:

| Header                  | Purpose                  |
| ----------------------- | ------------------------ |
| `Content-Type`          | artifact content type    |
| `Content-Length`        | artifact size            |
| `ETag`                  | R2/KV object etag        |
| `Last-Modified`         | upload timestamp         |
| `x-artifact-duration`   | task duration            |
| `x-artifact-tag`        | Turbo signed tag         |
| `x-artifact-sha`        | git SHA metadata         |
| `x-artifact-dirty-hash` | dirty workspace metadata |

### `POST /v8/artifacts`

Batch lookup.

The request body must be JSON with `hashes: string[]`. Hash values must be non-empty strings no longer than 256 characters. Lookup checks at most 1000 hashes per request.

Request:

```json
{ "hashes": ["abc", "def"] }
```

Response:

```json
{
  "abc": {
    "size": 12345,
    "taskDurationMs": 1200,
    "tag": "optional-signature-tag"
  },
  "def": null
}
```

### `POST /v8/artifacts/events`

Accepts Turbo hit/miss events.

Each event must use `event: "HIT" | "MISS"`, `source: "LOCAL" | "REMOTE"`, a string `hash`, and a non-negative numeric `duration`.

Request body:

```json
[
  {
    "event": "HIT",
    "source": "REMOTE",
    "hash": "abc",
    "duration": 123,
    "sessionId": "optional"
  }
]
```

Response:

```json
{ "accepted": true }
```

### `GET /v8/artifacts/events`

Returns an empty event history response for Turbo compatibility.

```json
[]
```

## Compatibility routes

| Route               | Purpose                          |
| ------------------- | -------------------------------- |
| `GET /v2/user`      | synthetic user for current token |
| `GET /v2/teams`     | teams allowed by current token   |
| `GET /v2/teams/:id` | one allowed team                 |

## Public route

| Route                    | Purpose                  |
| ------------------------ | ------------------------ |
| `GET /`                  | plain-text service label |
| `GET /management/health` | empty `200` health check |

## Internal routes

| Route                               | Method | Purpose                    |
| ----------------------------------- | ------ | -------------------------- |
| `/internal/health`                  | `GET`  | internal health check      |
| `/internal/teams/:team/stats`       | `GET`  | returns object count/bytes |
| `/internal/teams/:team/purge-all`   | `POST` | deletes team artifacts     |
| `/internal/artifacts/purge-expired` | `POST` | runs retention cleanup     |
| `/internal/metrics/summary`         | `GET`  | usage summary              |
| `/internal/tokens`                  | `GET`  | list D1 tokens             |
| `/internal/tokens`                  | `POST` | create D1 token            |
| `/internal/tokens/:id/revoke`       | `POST` | revoke D1 token            |

Metrics summary supports `?window=15m`, `?window=1h`, `?window=6h`, and `?window=24h`. It requires `CLOUDFLARE_ACCOUNT_ID`, `ANALYTICS_DATASET`, and `ANALYTICS_API_TOKEN`.

Internal routes require `INTERNAL_ADMIN_TOKEN`; missing admin-token config returns `503`, and a wrong token returns `403`. Token routes require `TOKEN_DB`. Metrics summary defaults to `window=1h`; invalid windows return `400`.
