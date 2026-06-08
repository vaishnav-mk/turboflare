# Agentic Setup

Use this when you want a coding agent to deploy Turboflare, wire your repo to it, and prove a real remote cache hit.

## Paste This Prompt

```txt
Set up Turboflare for this repo.

Goal: deploy a Cloudflare Worker + R2 remote cache for Turbo, configure this repo, and prove a real remote cache hit.

Rules:
- Use the smallest setup first: Worker, R2, one TURBO_TOKEN.
- Use pnpm dlx create-turboflare unless this repo is Turboflare itself.
- Do not print secrets.
- Do not commit .env.turboflare.
- Do not add D1, KV, Analytics, Rate Limiting, custom domains, or branch policies unless I ask.
- Stop and explain if Wrangler is not logged in or Cloudflare auth blocks deployment.

Done means:
- Worker URL is known.
- TURBO_API, TURBO_TEAM, and TURBO_TOKEN location are documented.
- Worker health check passes.
- Turbo write run completes.
- Turbo read run after local cache cleanup shows cache hit.
- Final answer includes exact commands run, pass/fail result, and any cleanup performed.
```

## What The Agent Should Discover

| Question               | Expected action                                               |
| ---------------------- | ------------------------------------------------------------- |
| Is this an app repo?   | run clone-free setup with `pnpm dlx create-turboflare`        |
| Is this Turboflare?    | run source setup with `pnpm setup`                            |
| Where is Turbo root?   | find `turbo.json` or `turbo.jsonc`, then run Turbo from there |
| Which package manager? | use `packageManager` or lockfile                              |
| Which tasks are safe?  | ask before running builds/tests                               |
| Is remote cache off?   | report `remoteCache.enabled=false`; do not fake success       |

## Fast Path

For a normal app repo:

```sh
pnpm dlx create-turboflare
```

For a Turboflare source checkout:

```sh
pnpm setup
```

The guided setup should create or reuse the R2 bucket, deploy the Worker, set the Worker secret, optionally write `.env.turboflare`, run health checks, and optionally run a real Turbo write/read verification.

## Manual Verification

If the agent needs to verify by hand, keep it simple:

```sh
set -a
. ./.env.turboflare
set +a

curl -i "$TURBO_API/management/health"
turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

The second Turbo run must show `cache hit`.

## Final Report Shape

Ask the agent to finish with this exact shape:

```txt
Turboflare setup: pass|partial|failed
Worker URL: https://...
TURBO_API: https://...
TURBO_TEAM: ...
TURBO_TOKEN: stored in Worker secret + .env.turboflare|not written
Health check: pass|failed
Remote write: pass|failed
Remote read: pass|failed
Cache hit: yes|no
Cleanup: ...
Next action, if any: ...
```

## Recovery Loops

| Symptom                   | Agent should do                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| Wrangler not logged in    | run `wrangler login` or stop with instructions                    |
| install command fails     | report package manager, command, and first useful error           |
| deploy succeeds, auth bad | reset Worker secret and retry without printing token              |
| Turbo misses              | compare task hash inputs, team name, dirty git state, and outputs |
| no safe Turbo task exists | stop after Worker health check and report manual Turbo command    |

## Guardrails

- Never print token values.
- Never commit `.env.turboflare`.
- Never delete user source files to force a clean cache run.
- Prefer a throwaway `TURBO_TEAM` for smoke tests.
- Keep optional production features out of the first pass.
