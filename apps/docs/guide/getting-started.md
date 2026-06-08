# Getting Started

Turboflare gives Turborepo a remote cache endpoint backed by Cloudflare Workers and R2.

There are three setup paths:

| Path                  | Best for                                          |
| --------------------- | ------------------------------------------------- |
| Clone-free setup      | normal users who just want a cache Worker         |
| Agentic setup         | letting an AI coding agent deploy and verify      |
| Manual setup          | production setup, CI, controlled Cloudflare work  |
| Source-checkout setup | contributors or users modifying Turboflare itself |

## Clone-free setup

Run the installer from your app repo. You do not need to clone Turboflare:

```sh
pnpm dlx create-turboflare
```

It downloads Turboflare to a temporary directory, asks for the few values that cannot be inferred, then deletes the temporary files after setup.

| Step | What happens                                         |
| ---- | ---------------------------------------------------- |
| 1    | checks Wrangler login                                |
| 2    | downloads Turboflare to a temp directory             |
| 3    | creates the configured R2 bucket if missing          |
| 4    | deploys the Worker                                   |
| 5    | generates or accepts a `TURBO_TOKEN`                 |
| 6    | stores `TURBO_TOKEN` as a Worker secret              |
| 7    | optionally writes `.env.turboflare` in your app repo |
| 8    | checks health, unauthenticated status, and auth      |
| 9    | optionally runs a real Turbo write/read check        |

If you write `.env.turboflare`, keep it out of git. Add `.env.turboflare` or `.env.*` to your app repo's ignore rules if needed.

At the end, the installer can optionally run a real Turbo cache check for this repo. If you choose yes, it finds the outermost Turbo root, supports `turbo.json` and `turbo.jsonc`, uses the repo's package manager, asks which Turbo tasks to run, writes to remote cache, removes the configured local Turbo cache to force a remote read, then runs the same tasks again. It skips this check when `remoteCache.enabled=false`. It prints Turbo's output with the token redacted, verifies that the second run reports a remote `cache hit`, and shows how long setup and verification took. Only choose this if those tasks are safe to run now.

## What is `TURBO_TEAM`?

`TURBO_TEAM` is Turbo's cache namespace. Turboflare uses it to keep cache artifacts grouped under a stable name.

Use a short repo or org name, for example `acme-web` or `my-app`. Use the same value in local dev and CI if you want both places to share cache artifacts.

`TURBO_TEAM` does not need to match a real Vercel team when you use Turboflare.

Use it in your app shell:

```sh
set -a
. ./.env.turboflare
set +a

turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

The second run should report a remote `cache hit`.

## Agentic setup

Use this when a coding agent has access to your shell and repo.

For the standalone agent prompt and acceptance checklist, see [Agentic Setup](/guide/agentic-setup/).

Give the agent this prompt:

```txt
Set up Turboflare for this repo. Use the turboflare-setup skill if available.
Start with the smallest setup: Worker + R2 + one TURBO_TOKEN.
Use Wrangler, do not print secrets, and verify a real Turbo remote cache hit.
Stop before optional D1, KV, Analytics, Rate Limiting, or custom domains unless I ask.
Final report must include Worker URL, TURBO_API, TURBO_TEAM, remote write result, remote read result, and cache hit count.
```

Agent acceptance criteria:

| Check                          | Required result                 |
| ------------------------------ | ------------------------------- |
| Worker deployed                | URL recorded                    |
| R2 binding                     | `ARTIFACTS` present             |
| Turbo token                    | stored as secret, never printed |
| unauthenticated status         | `401`                           |
| authenticated status           | `200`                           |
| first Turbo run                | writes remote cache             |
| second Turbo run after cleanup | reports remote `cache hit`      |

## Source-checkout setup

Use this only if you are developing Turboflare itself or want to modify the Worker before deploying it:

```sh
git clone https://github.com/vaishnav-mk/turboflare.git
cd turboflare
pnpm install
pnpm setup
```

This keeps the full source checkout, including docs, tests, fixtures, and scripts. Normal users should prefer clone-free setup.

## Manual setup

Use this when you want to see every moving piece.

### 1. Deploy

```sh
pnpm install
pnpm deploy
```

`pnpm deploy` creates the configured R2 bucket when missing, then deploys `apps/cache-worker`.

Expected output includes a Worker URL:

```txt
https://<worker-name>.<subdomain>.workers.dev
```

### 2. Set a Turbo token

In the Cloudflare dashboard, add a Worker secret named `TURBO_TOKEN`.

With Wrangler:

```sh
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
```

Use a long random token. Turborepo sends it as `Authorization: Bearer <token>`.

### 3. Point Turbo at the Worker

In your app repo or CI environment:

```sh
export TURBO_API="https://<worker-name>.<subdomain>.workers.dev"
export TURBO_TOKEN="<same token>"
export TURBO_TEAM="team-name"
```

`TURBO_API` must be the Worker origin only. Do not append protocol paths.

### 4. Prove a remote hit

```sh
turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

Run the same task twice from a clean state. The first run uploads artifacts. The second command should show a remote `cache hit`.

You can also check basic endpoint behavior:

| Check                | Expected |
| -------------------- | -------- |
| health endpoint      | `200`    |
| missing Turbo token  | rejected |
| matching Turbo token | accepted |

## What gets cached?

Turboflare stores Turbo task cache artifacts for task hashes. It does not store deployments and it does not warm future commits automatically.

| Thing       | Example                            |
| ----------- | ---------------------------------- |
| artifact id | Turbo task hash                    |
| metadata    | duration, tag, SHA, dirty hash     |
| body        | compressed task outputs from Turbo |
| storage key | `v1/team/{team}/artifact/{hash}`   |

## Recommended production baseline

| Area          | Recommended setting                                    |
| ------------- | ------------------------------------------------------ |
| storage       | R2 default                                             |
| auth          | `TURBO_TOKEN` or scoped static tokens                  |
| retention     | R2 lifecycle enabled                                   |
| admin         | separate `INTERNAL_ADMIN_TOKEN` if using `/internal/*` |
| branch policy | keep `shared` unless you need PR isolation             |
| signatures    | require Turbo signature tags for stricter CI           |
