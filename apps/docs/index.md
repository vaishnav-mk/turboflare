## Why Turboflare

Turborepo remote cache should be boring infrastructure: deploy it, set a token, point CI at it, and move on.

## Alpha

Turboflare is still in the works. Expect rough edges and breaking changes.

- Interested in using it? DM [@wishee0](https://x.com/wishee0).
- Found a bug? [Open a bug report](https://github.com/vaishnav-mk/turboflare/issues/new?labels=bug).
- Want a feature? [Open a feature request](https://github.com/vaishnav-mk/turboflare/issues/new?labels=enhancement).

![Turboflare request flow](/diagrams/request-flow.svg)

Quick context:

- [Turborepo](https://turbo.build/repo) hashes each task from inputs, command, env, and outputs.
- [Remote caching](https://turbo.build/repo/docs/core-concepts/remote-caching) lets one runner upload a task result and another runner restore it.
- This matters most in CI because fresh runners usually start with no local cache.

Measured in Turboflare's own CI run [27145453178](https://github.com/vaishnav-mk/turboflare/actions/runs/27145453178):

| CI step                  |  Time | Meaning                       |
| ------------------------ | ----: | ----------------------------- |
| no remote cache          | `95s` | rebuild everything            |
| cold Turbo seed + upload | `94s` | compute once, store artifacts |
| remote-cache rebuild     |  `2s` | restore matching task hashes  |

Thanks to Vercel for making Turborepo and the remote cache protocol easy to use and self-host. If [Vercel Remote Cache](https://turbo.build/repo/docs/core-concepts/remote-caching) fits your project, use it. Turboflare is for teams that specifically want the cache Worker and artifacts in their own Cloudflare account.

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
