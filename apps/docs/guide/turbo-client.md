# Turbo Client Setup

Turboflare is used by setting standard Turbo remote cache environment variables.

If you used `pnpm dlx create-turboflare` or source-checkout `pnpm setup` and chose to write a local env file, load `.env.turboflare`:

```sh
set -a
. ./.env.turboflare
set +a
```

## Basic setup

```sh
export TURBO_API="https://<worker-name>.<subdomain>.workers.dev"
export TURBO_TOKEN="<worker-secret-token>"
export TURBO_TEAM="team-name"
```

Run Turbo normally:

```sh
turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

Turbo handles cache lookup, upload, and restore. Turboflare only serves the remote cache protocol. The second run should report `cache hit`.

## CI example

```yaml
jobs:
  build:
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
      - run: pnpm turbo run build test
        env:
          TURBO_API: https://<worker-name>.<subdomain>.workers.dev
          TURBO_TEAM: my-team
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
```

## What Turbo uploads

Turbo uploads task cache artifacts for task hashes. A cache hit requires the task hash to match.

Common reasons a task does not hit:

| Cause                    | Fix                                      |
| ------------------------ | ---------------------------------------- |
| different git state      | compare commit and dirty files           |
| missing `TURBO_TEAM`     | set a stable team name                   |
| changed env inputs       | inspect `turbo.json` inputs/env          |
| no task outputs          | define cacheable outputs in `turbo.json` |
| token cannot access team | check scoped token `teams`               |

## Signed cache client config

In `turbo.json`:

```json
{
  "remoteCache": {
    "signature": true
  }
}
```

Set:

```sh
export TURBO_REMOTE_CACHE_SIGNATURE_KEY="..."
```

On the server, use:

```txt
SIGNATURE_POLICY=require
```

This rejects uploads missing Turbo's signature tag. Turbo clients still verify signed artifacts when restoring them.

## Branch-aware team names

If branch policies are enabled, you can encode branch name in `TURBO_TEAM`:

```sh
export TURBO_TEAM="my-team@${GITHUB_HEAD_REF:-main}"
```

When `BRANCH_CACHE_POLICY=shared`, Turboflare treats `my-team@branch` as a literal team name for compatibility. Branch parsing only activates when branch policies are enabled.

Branch names are client-supplied. Do not treat branch policy as an auth boundary; use scoped/read-only tokens for untrusted PRs.

## Read-only remote cache

For jobs that should restore but not upload:

```sh
turbo run build --cache=local:,remote:r
```

For jobs that should upload but not restore:

```sh
turbo run build --cache=local:,remote:w
```

Most users can let Turbo use its default remote cache behavior after setting `TURBO_API`, `TURBO_TOKEN`, and `TURBO_TEAM`.
