# Examples

Copy these snippets into your setup and adjust names/secrets.

## Minimal local shell

```sh
export TURBO_API="https://turboflare-cache-worker.example.workers.dev"
export TURBO_TOKEN="tf_..."
export TURBO_TEAM="acme"

turbo run build
```

## GitHub Actions

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
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
      - run: pnpm turbo run typecheck test build
        env:
          TURBO_API: https://turboflare-cache-worker.example.workers.dev
          TURBO_TEAM: acme
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
```

## Branch-aware GitHub Actions

```yaml
env:
  TURBO_API: https://turboflare-cache-worker.example.workers.dev
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: acme@${{ github.head_ref || github.ref_name }}
```

Worker vars:

```txt
BRANCH_CACHE_POLICY=main-write-pr-read
DEFAULT_BRANCH=main
BRANCH_RETENTION_DAYS=7
```

## Read-only PR cache

For untrusted PRs, use a read-only token or server policy.

Scoped token example:

```json
[
  {
    "id": "pr-read",
    "token": "read-token",
    "teams": ["acme"],
    "scopes": ["read"]
  }
]
```

Server policy example:

```txt
BRANCH_CACHE_POLICY=read-only-pr
DEFAULT_BRANCH=main
```

## Signed cache

Worker var:

```txt
SIGNATURE_POLICY=require
```

`turbo.json`:

```json
{
  "remoteCache": {
    "signature": true
  }
}
```

CI env:

```yaml
env:
  TURBO_REMOTE_CACHE_SIGNATURE_KEY: ${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}
```

## Internal purge

```sh
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_ADMIN_TOKEN" \
  https://<worker>/internal/teams/acme/purge-all
```

## R2 lifecycle

```sh
CLOUDFLARE_ACCOUNT_ID=... \
CLOUDFLARE_API_TOKEN=... \
RETENTION_DAYS=30 \
ABORT_MULTIPART_DAYS=1 \
pnpm r2:lifecycle
```
