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

Common headers:

| Header                  | Purpose                  |
| ----------------------- | ------------------------ |
| `Content-Length`        | artifact size            |
| `ETag`                  | R2/KV object etag        |
| `Last-Modified`         | upload timestamp         |
| `x-artifact-duration`   | task duration            |
| `x-artifact-tag`        | Turbo signed tag         |
| `x-artifact-sha`        | git SHA metadata         |
| `x-artifact-dirty-hash` | dirty workspace metadata |

### `POST /v8/artifacts`

Batch lookup.

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

| Route                               | Method | Purpose                     |
| ----------------------------------- | ------ | --------------------------- |
| `/internal/health`                  | `GET`  | internal health check       |
| `/internal/teams/:team/stats`       | `GET`  | team object count and bytes |
| `/internal/teams/:team/purge-all`   | `POST` | delete team artifacts       |
| `/internal/artifacts/purge-expired` | `POST` | run retention cleanup       |
| `/internal/tokens`                  | `GET`  | list D1 tokens              |
| `/internal/tokens`                  | `POST` | create D1 token             |
| `/internal/tokens/:id/revoke`       | `POST` | revoke D1 token             |
