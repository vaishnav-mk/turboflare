# Auth & Teams

Turboflare uses bearer tokens for Turbo cache routes. Internal admin routes use a separate admin token.

## Simple token

Set `TURBO_TOKEN` as a Worker secret:

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Client env:

```sh
export TURBO_TOKEN="..."
```

## Scoped static tokens

Use `TURBO_TOKEN_SCOPES` for team-limited or read-only tokens.

```json
[
  {
    "id": "ci-write",
    "token": "secret-token",
    "teams": ["team_turboflare"],
    "scopes": ["read", "write"]
  },
  {
    "id": "ci-read",
    "token": "read-token",
    "teams": ["team_turboflare"],
    "scopes": ["read"]
  }
]
```

| Scope   | Allows                            |
| ------- | --------------------------------- |
| `read`  | status, lookup, GET, HEAD, events |
| `write` | artifact upload                   |

## D1 tokens

Use D1 tokens when you need token rotation, team scoping, expiration, or revocation without redeploying Worker secrets.

1. Bind `TOKEN_DB`.
2. Apply schema:

```sh
wrangler d1 execute <token-db-name> --file apps/cache-worker/schema/001_tokens.sql
```

3. Set `INTERNAL_ADMIN_TOKEN`.
4. Use `/internal/tokens` routes.

Token hashes are lowercase hex SHA-256 of raw tokens. Raw tokens are returned only once when created.

D1 is used here because token auth is structured state, not blob storage. A token row has an id, hash, teams, scopes, optional expiration, revocation timestamp, and audit entries. R2 stores artifacts; D1 stores auth records.

Static tokens and D1 tokens can coexist. Authentication checks static env tokens first, then falls back to `TOKEN_DB` when it is bound.

## Internal admin token

Internal routes are separate from Turbo bearer auth.

```sh
wrangler secret put INTERNAL_ADMIN_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Missing internal token config returns `503`. Wrong admin token returns `403`.

## Team resolution

Turboflare accepts common Turbo cache server selectors:

| Selector | Example            | Result              |
| -------- | ------------------ | ------------------- |
| `slug`   | `?slug=web`        | team key `web`      |
| `teamId` | `?teamId=team_abc` | team key `team_abc` |
| `team`   | `?team=web`        | team key `web`      |
| none     | no query           | team key `global`   |

Scoped tokens check the resolved team key.

## Turbo `/v2` compatibility

Turbo can discover user/team metadata from Vercel-style endpoints.

| Route           | Result                           |
| --------------- | -------------------------------- |
| `/v2/user`      | synthetic user based on token id |
| `/v2/teams`     | teams allowed by the token       |
| `/v2/teams/:id` | one allowed team                 |

These routes use the same bearer auth as `/v8` and require read scope.

## Branch-aware teams

When `BRANCH_CACHE_POLICY` is not `shared`, Turboflare can parse branches from `TURBO_TEAM=team@branch`.

This keeps stock Turbo clients working while allowing branch-isolated storage keys.

Examples:

| Client input           | Team  | Branch  |
| ---------------------- | ----- | ------- |
| `TURBO_TEAM=web`       | `web` | none    |
| `TURBO_TEAM=web@main`  | `web` | `main`  |
| `TURBO_TEAM=web@pr-12` | `web` | `pr-12` |

Explicit `?branch=` or `x-turboflare-branch` wins over the `team@branch` convention.
