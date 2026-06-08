---
name: turboflare-setup
description: Set up Turboflare, the Cloudflare-native remote cache for Turborepo. Use this skill whenever the user wants to deploy Turboflare, add Turborepo remote caching, configure Turbo with Cloudflare Workers/R2, verify remote cache hits, create a Cloudflare Deploy Button flow, or debug first-run onboarding. This should trigger even if the user only says “set up remote cache”, “make Turbo cache work”, “deploy the cache worker”, “use R2 for Turbo”, or “get CI using Turboflare”.
---

# Turboflare Setup

Help the user reach a verified remote cache hit quickly. Default to the smallest reliable setup: Cloudflare Worker, R2 bucket, and one Turbo bearer token. Do not introduce D1, KV, Analytics, Rate Limiting, custom domains, or lifecycle automation until the base cache works.

Project links:

- Docs: https://turboflare.vaishnav.one/
- Repository: https://github.com/vaishnav-mk/turboflare
- Bugs: https://github.com/vaishnav-mk/turboflare/issues/new?labels=bug
- Feature requests: https://github.com/vaishnav-mk/turboflare/issues/new?labels=enhancement
- Contact: https://x.com/wishee0

Turboflare is alpha software. Make that clear in final reports: expect breaking changes and rough edges while it hardens.

## Outcome

The setup is done only when all of these are true:

- The Worker is deployed.
- The Worker has an `ARTIFACTS` R2 binding.
- A Turbo token is configured as a secret or safe env var.
- The user has exact `TURBO_API` and `TURBO_TEAM` values, and knows where `TURBO_TOKEN` was stored.
- A real `turbo run ...` has populated remote cache with `remote:w`.
- A second real `turbo run ...` has restored from remote cache with `remote:r` and shows `cache hit`.
- Smoke data has been purged, or the user explicitly asked to keep it.

## First Decision

Identify which mode applies:

- **Deploy Turboflare itself**: the current repo is Turboflare or a fork. Use Wrangler from this repo.
- **Use Turboflare from an app repo**: the user is inside their own monorepo and wants remote caching. Do not copy Worker internals into their app. Deploy Turboflare separately or point them at an existing Turboflare endpoint.
- **CI-only onboarding**: the Worker already exists; configure CI env vars and prove a hit.

Ask at most one blocking question if mode is unclear. Otherwise inspect files and proceed.

## Fast Path

Use this path unless the user asks for advanced features.

For normal users, prefer clone-free setup. Do not clone Turboflare into their app repo just to deploy it:

```sh
pnpm dlx create-turboflare
```

If the current repo is Turboflare itself, use the source-checkout guided setup script:

```sh
pnpm setup
```

Use the manual steps below when the guided script is not suitable, when it fails, or when the user wants every command controlled explicitly.

1. Check tools and auth:

```sh
pnpm exec wrangler --version
pnpm exec wrangler whoami
```

2. Install dependencies if needed:

```sh
pnpm install
```

3. Create or confirm the R2 bucket configured in `apps/cache-worker/wrangler.jsonc`:

```sh
pnpm exec wrangler r2 bucket create <bucket-name>
```

If the bucket already exists, continue.

4. Deploy the Worker:

```sh
pnpm --filter @turboflare/cache-worker deploy
```

5. Configure `TURBO_TOKEN` securely. Prefer `wrangler secret put TURBO_TOKEN`; do not print or commit token values.

6. Run a real Turbo smoke from a real Turborepo workspace. Use the package manager declared in `package.json#packageManager` or implied by the lockfile. Run from the Turbo root that owns `turbo.json` or `turbo.jsonc`, not from a random package subdirectory:

```sh
export TURBO_API="https://<worker>.<subdomain>.workers.dev"
export TURBO_TOKEN="<redacted>"
export TURBO_TEAM="<team-or-smoke-id>"

turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

Use the deployed Worker URL for `TURBO_API`. If Turbo cannot connect, report the failed command and the Worker smoke-check status.
If `remoteCache.enabled=false` in root config, do not treat a missed remote hit as a Turboflare failure; Turbo is configured not to use remote cache.

7. Report the exact result:

```text
remote write: pass/fail
remote read: pass/fail
cache hits: <n>/<n>
TURBO_API: https://...
TURBO_TEAM: ...
```

## Remote Smoke Matrix

After deploy, verify real Cloudflare behavior, not only unit tests.

Base protocol:

- `GET /management/health` returns `200`.
- `GET /v8/artifacts/status` without auth returns `401`.
- Authenticated `GET /v8/artifacts/status` returns `status: enabled` unless configured otherwise.
- `OPTIONS /v8/artifacts/:hash` returns Turbo-compatible CORS headers.
- `GET /v2/user` and `/v2/teams/:id` work with valid auth.

R2 artifact path:

- `PUT /v8/artifacts/:hash?teamId=...` with `application/octet-stream` succeeds.
- `HEAD` returns size and artifact headers.
- `GET` returns exact bytes.
- `POST /v8/artifacts` returns the object-map lookup shape: `{ "hash": { ... } | null }`.
- Duplicate `PUT` overwrites and next `GET` returns new bytes.
- Bad content type, oversized `Content-Length`, and oversized no-length stream fail.

Real Turbo client:

- First run with `--cache=local:,remote:w` executes tasks and uploads artifacts.
- Clear local cache/generated outputs.
- Second run with `--cache=local:,remote:r` shows remote `cache hit`.
- If `TURBO_API` fails, document the exact Turbo output and the smoke-check results; do not claim the Worker protocol is broken without evidence.

Admin cleanup:

- If `INTERNAL_ADMIN_TOKEN` is configured, call `/internal/teams/:team/purge-all` for smoke teams.
- Verify `truncated: false` for normal smoke runs.

## Advanced Features

Add these only after the base R2 setup works.

### D1 Token DB

Use when the user needs hashed tokens, revocation, scoped tokens, or token audit.

1. Create D1 database.
2. Bind it as `TOKEN_DB`.
3. Apply `apps/cache-worker/schema/001_tokens.sql`.
4. Use `/internal/tokens` to create a token.
5. Verify the token can access allowed teams and fails after revoke.
6. Verify duplicate token ID/hash returns `409`.

### D1 Artifact Index

Use when the user needs queryable artifact metadata.

1. Create D1 database.
2. Bind it as `ARTIFACT_INDEX`.
3. Apply `apps/cache-worker/schema/002_artifact_index.sql`.
4. Upload an artifact.
5. Query D1 to verify one row.
6. Purge the team and verify the row is deleted.

The D1 index is not source of truth. R2 remains source of truth for artifacts.

### KV Store

Use only for small-artifact fallback. R2 is preferred.

1. Create KV namespace.
2. Bind it as `ARTIFACTS_KV`.
3. Set `ARTIFACT_STORE=kv`.
4. Verify small `PUT`/`HEAD`/`GET`/lookup.
5. Verify the KV 25 MiB cap behavior.

KV has no metadata-only `HEAD`; expect worse behavior for larger artifacts.

### Cache API Reads

Use when the user wants read acceleration.

1. Set `CACHE_API_READS=true`.
2. Read an artifact once to fill cache.
3. Overwrite the artifact.
4. Read again and verify new bytes, proving cache invalidation works.

## Safety Rules

- Do not print secrets in logs or final output. Redact token values.
- Do not commit generated Wrangler configs containing real tokens.
- Do not use destructive cleanup against non-smoke team names unless the user explicitly approves.
- Do not use `git reset --hard`, force pushes, or repository-wide cleanup to “fix” onboarding.
- Prefer throwaway team names like `smoke-<timestamp>` for verification.
- Keep onboarding R2-first. KV/D1/Analytics/Rate Limit are optional.

## Common Failure Modes

### Turbo cannot connect

Check these in order:

- `TURBO_API` includes protocol and no `/v8` suffix.
- `TURBO_TOKEN` matches Worker secret.
- `TURBO_TEAM`, `TURBO_TEAMID`, or `team` is set.
- `GET $TURBO_API/v8/artifacts/status` works with bearer auth.

### First run works, second run misses

Check:

- Second run uses same team and same task hash.
- Local generated outputs were removed before the read test.
- First run used `remote:w` or `remote:rw`.
- Second run used `remote:r` or `remote:rw`.
- R2 has the object under the expected team namespace.

### Deploy succeeds but cache fails

Check:

- R2 bucket binding name is exactly `ARTIFACTS`.
- `TURBO_TOKEN` is configured in deployed Worker, not only local shell.
- Worker URL in `TURBO_API` points to the deployed Worker version.
- `wrangler deploy` output shows the expected bindings.

## Final Report

End with a compact report:

```text
deployed: yes/no
worker: <url>
r2 bucket: <name>
turbo api: <redacted-safe-url>
remote write: pass/fail
remote read: pass/fail
cache hits: <n>/<n>
optional features tested: <list>
cleanup: <what was purged/deleted>
follow-ups: <only if needed>
bugs/features: https://github.com/vaishnav-mk/turboflare/issues
contact: https://x.com/wishee0
```
