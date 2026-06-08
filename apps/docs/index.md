## Why Turboflare

Turborepo remote cache should be boring infrastructure: deploy it, set a token, point CI at it, and move on.

| Need                     | Turboflare gives you                                |
| ------------------------ | --------------------------------------------------- |
| Fast global reads        | Cloudflare Workers + optional Cache API             |
| Durable artifact storage | R2 as source of truth                               |
| Simple auth              | static tokens, scoped tokens, optional D1 tokens    |
| Ops control              | R2 lifecycle, bounded cleanup, internal purge/stats |
| Stock Turbo support      | `/v8/artifacts` plus `/v2` team discovery           |

## Request flow

![Turboflare request flow](/diagrams/request-flow.svg)

## Choose a setup path

| Path             | Use when                                    | Start here                                 |
| ---------------- | ------------------------------------------- | ------------------------------------------ |
| Clone-free setup | you want Wrangler to ask and fill values    | [Getting Started](/guide/getting-started/) |
| Agentic setup    | you want an AI coding agent to do it safely | [Agentic Setup](/guide/agentic-setup/)     |
| Manual setup     | you want every Cloudflare step explicit     | [Deploy](/guide/deploy/)                   |

```sh
pnpm dlx create-turboflare
```

## The shortest manual version

```sh
pnpm install
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
pnpm deploy
```

```sh
export TURBO_API="https://<worker-name>.<subdomain>.workers.dev"
export TURBO_TOKEN="<same token>"
export TURBO_TEAM="team-name"
turbo run build --cache=local:,remote:w
rm -rf .turbo
turbo run build --cache=local:,remote:r
```

Turboflare stores Turbo task cache artifacts. It does not deploy your application code.

## Where to go next

| If you want to...           | Read this                                        |
| --------------------------- | ------------------------------------------------ |
| deploy the Worker           | [Deploy](/guide/deploy/)                         |
| configure Turbo clients     | [Turbo Client Setup](/guide/turbo-client/)       |
| understand the system shape | [Architecture](/guide/architecture/)             |
| tune R2 and cleanup         | [Storage & Retention](/guide/storage-retention/) |
| set up teams and tokens     | [Auth & Teams](/guide/auth-teams/)               |
| operate production          | [Operations](/guide/operations/)                 |
