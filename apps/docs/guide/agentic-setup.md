# Agentic Setup

Use this when a coding agent has shell access to your repo and you want it to deploy Turboflare safely.

Give the agent this prompt:

```txt
Set up Turboflare for this repo. Use the turboflare-setup skill if available.
Start with the smallest setup: Worker + R2 + one TURBO_TOKEN.
Use Wrangler, do not print secrets, and verify a real Turbo remote cache hit.
Stop before optional D1, KV, Analytics, Rate Limiting, or custom domains unless I ask.
Final report must include Worker URL, TURBO_API, TURBO_TEAM, remote write result, remote read result, and cache hit count.
```

## Acceptance Criteria

| Check                          | Required result                 |
| ------------------------------ | ------------------------------- |
| Worker deployed                | URL recorded                    |
| R2 binding                     | `ARTIFACTS` present             |
| Turbo token                    | stored as secret, never printed |
| unauthenticated status         | `401`                           |
| authenticated status           | `200`                           |
| first Turbo run                | writes remote cache             |
| second Turbo run after cleanup | reports remote `cache hit`      |

## What The Agent Should Do

1. Prefer clone-free setup for normal app repos:

```sh
pnpm dlx create-turboflare
```

2. Use source setup only inside a Turboflare checkout:

```sh
pnpm setup
```

3. Verify the Worker directly:

```sh
curl -i https://<worker>/management/health
curl -i https://<worker>/v8/artifacts/status
curl -i -H "Authorization: Bearer $TURBO_TOKEN" \
  https://<worker>/v8/artifacts/status
```

4. Verify a real Turbo remote cache hit from the Turbo root:

```sh
set -a
. ./.env.turboflare
set +a

turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

The second run must show `cache hit`.

## Guardrails

- Do not print token values.
- Do not commit `.env.turboflare`.
- Do not clone Turboflare into the app repo unless the user explicitly wants source changes.
- Do not add optional D1, KV, Analytics, Rate Limiting, custom domains, or lifecycle automation until the base cache works.
- If `remoteCache.enabled=false`, report that Turbo is configured not to use remote cache instead of treating the miss as a Turboflare failure.
