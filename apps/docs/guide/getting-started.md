# Getting Started

Turboflare gives Turborepo a remote cache endpoint backed by Cloudflare Workers and R2.

There are three setup paths:

| Path                  | Best for                                          |
| --------------------- | ------------------------------------------------- |
| Clone-free setup      | normal users who just want a cache Worker         |
| Manual setup          | production setup, CI, controlled Cloudflare work  |
| Agentic setup         | letting an AI coding agent deploy and verify      |
| Source-checkout setup | contributors or users modifying Turboflare itself |

## Clone-free setup

Run the installer from your app repo. You do not need to clone Turboflare:

```sh
pnpm dlx "github:vaishnav-mk/turboflare#path:packages/create-turboflare"
```

It downloads Turboflare to a temporary directory, asks for the few values that cannot be inferred, then deletes the temporary files after setup.

| Step | What happens                                    |
| ---- | ----------------------------------------------- |
| 1    | checks Wrangler login                           |
| 2    | downloads Turboflare to a temp directory        |
| 3    | creates the configured R2 bucket if missing     |
| 4    | deploys the Worker                              |
| 5    | generates or accepts a `TURBO_TOKEN`            |
| 6    | stores `TURBO_TOKEN` as a Worker secret         |
| 7    | writes `.env.turboflare` in your app repo       |
| 8    | checks health, unauthenticated status, and auth |

The generated `.env.turboflare` file is ignored by git.

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

`TURBO_API` must not include a trailing slash or `/v8` suffix.

### 4. Prove a remote hit

```sh
turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

Run the same task twice from a clean state. The first run uploads artifacts. The second command should show a remote `cache hit`.

If Turbo says it cannot connect over HTTPS but `curl` can reach the Worker, your network may be intercepting TLS with a certificate that Turbo's rustls client rejects. Prefer a custom HTTPS domain or exclude the Worker host from TLS inspection. Use plaintext HTTP only for diagnosis with a throwaway token, then rotate it.

You can also check basic endpoint behavior:

| Request                                    | Expected                  |
| ------------------------------------------ | ------------------------- |
| `GET /management/health`                   | `200`                     |
| unauthenticated `GET /v8/artifacts/status` | `401`                     |
| authenticated `GET /v8/artifacts/status`   | `{ "status": "enabled" }` |

## Agentic setup

Use this when a coding agent has access to your shell and repo.

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
| signatures    | use `SIGNATURE_POLICY=require` for stricter CI         |
