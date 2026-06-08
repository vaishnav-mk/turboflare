## Why Turboflare

Turborepo remote cache should be boring infrastructure: deploy it, set a token, point CI at it, and move on.

Turborepo hashes each task from its inputs, command, env, and outputs. A remote cache lets one machine upload the result for a task hash, then another machine restore that result instead of rebuilding it. This is most useful in CI, where fresh runners usually start with an empty local cache.

The win can be large when task hashes match. In Turboflare's own CI run `27145453178`, the uncached comparison build step took `95s`; the cold Turbo seed/upload step took `94s`; the rebuild from remote cache took `2s`. That is the build step dropping from about a minute and a half to a couple seconds, because the second job restored cached outputs instead of recomputing them.

Thanks to Vercel for making Turborepo and its remote cache protocol straightforward to use and self-host. If Vercel Remote Cache fits your project, use it; it is the easiest path. Turboflare is for the cases where you specifically want the cache Worker and artifacts in your own Cloudflare account.

| Need                     | Turboflare gives you                                |
| ------------------------ | --------------------------------------------------- |
| Fast global reads        | Cloudflare Workers + optional Cache API             |
| Durable artifact storage | R2 as source of truth                               |
| Simple auth              | static tokens, scoped tokens, optional D1 tokens    |
| Ops control              | R2 lifecycle, bounded cleanup, internal purge/stats |
| Turbo support            | standard remote cache behavior, no client fork      |

## If this sounds like your team

| You have...                            | Turboflare helps by...                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| PRs rebuilding the same packages       | restoring cached Turbo tasks from Cloudflare.              |
| cache data that must stay in your org  | keeping artifacts in your R2 bucket with your own tokens.  |
| open-source forks or untrusted PRs     | pairing read-only tokens with branch-aware cache policies. |
| teams split across regions             | serving repeated reads from nearby Cloudflare PoPs.        |
| too much infra for a build cache       | replacing cache servers with one Worker and one R2 bucket. |
| client projects that cannot share data | namespacing each repo, customer, or branch independently.  |

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
pnpm deploy
wrangler secret put TURBO_TOKEN --config apps/cache-worker/wrangler.jsonc
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
