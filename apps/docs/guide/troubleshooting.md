# Troubleshooting

Start with the status endpoint:

```sh
curl -i -H "Authorization: Bearer $TURBO_TOKEN" \
  https://<worker>/v8/artifacts/status
```

Expected:

```json
{ "status": "enabled" }
```

## Common issues

| Symptom                                         | Likely cause                                                 | Fix                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `401` on `/v8/artifacts/status`                 | missing/wrong bearer token                                   | set matching Worker secret and client env                                                               |
| `403` on upload                                 | token lacks write scope                                      | check scoped token `scopes`                                                                             |
| `403` on team                                   | token cannot access team                                     | check `TURBO_TEAM` and token `teams`                                                                    |
| `403` on PR write                               | `read-only-pr` policy                                        | use main branch or change policy                                                                        |
| `411` in KV mode                                | missing `Content-Length`                                     | use R2 or send `Content-Length`                                                                         |
| `413` in KV mode                                | artifact above KV limit                                      | use R2                                                                                                  |
| no cache hits                                   | different task hash                                          | inspect Turbo inputs, env, git dirty state                                                              |
| internal route `503`                            | admin token or optional DB missing                           | configure `INTERNAL_ADMIN_TOKEN`, `TOKEN_DB`, or `ARTIFACT_INDEX`                                       |
| lifecycle fails                                 | Cloudflare API settings                                      | check account id, API token, bucket name, jurisdiction                                                  |
| Turbo says `Could not connect` but `curl` works | TLS inspection certificate rejected by Turbo's rustls client | use a custom HTTPS domain or exclude the host from TLS inspection; use HTTP only with a throwaway token |

## Verify live Worker auth

Unauthenticated status should be rejected:

```sh
curl -i https://<worker>/v8/artifacts/status
```

Authenticated status should work:

```sh
curl -i -H "Authorization: Bearer $TURBO_TOKEN" \
  https://<worker>/v8/artifacts/status
```

## Verify R2 binding

Run a Wrangler dry-run build:

```sh
pnpm build
```

The output should show:

```txt
env.ARTIFACTS (...) R2 Bucket
```

## Verify Turbo cache behavior

Run with full logs:

```sh
TURBO_API=... TURBO_TOKEN=... TURBO_TEAM=... \
turbo run build --cache=local:,remote:w --output-logs=full
rm -rf .turbo
TURBO_API=... TURBO_TOKEN=... TURBO_TEAM=... \
turbo run build --cache=local:,remote:r --output-logs=full
```

Look for Turbo remote cache lines and a `cache hit` on the second run.

If repeated runs miss, check:

| Check                   | Why                                    |
| ----------------------- | -------------------------------------- |
| `TURBO_TEAM` stable     | team is part of remote cache namespace |
| task outputs configured | Turbo cannot restore missing outputs   |
| env vars in task hash   | changed env means changed hash         |
| dirty files             | workspace state can affect hashes      |
| branch policy           | branch namespace may isolate reads     |

## Local integration proof

The repo includes a real Turbo fixture test:

```sh
pnpm test:integration
```

It runs a local Worker handler, uploads artifacts on the first run, and restores cache hits on the second run.
