# Architecture

Turboflare keeps the hot path intentionally small: authenticate, resolve tenant, construct a storage key, stream the artifact store. In the default setup, that store is R2.

![Turboflare request flow](/diagrams/request-flow.svg)

## Modules

| Module              | Responsibility                                                   |
| ------------------- | ---------------------------------------------------------------- |
| `app/router.ts`     | route dispatch and shared `/v8` auth flow                        |
| `auth/*`            | static tokens, scoped tokens, D1 token auth, internal admin auth |
| `tenancy/*`         | team and branch resolution                                       |
| `routes/v8/*`       | Turbo protocol endpoints                                         |
| `storage/*`         | R2/KV storage, keys, metadata, cleanup, D1 index                 |
| `observability/*`   | Analytics Engine datapoints                                      |
| `rate-limit/*`      | optional Rate Limiting binding enforcement                       |
| `routes/internal/*` | admin stats, purge, token management, cleanup                    |

## Hot path

Artifact upload:

```txt
PUT /v8/artifacts/:artifactId
  -> validate bearer token and write scope
  -> resolve tenant/team/branch
  -> enforce read-only and signature policy
  -> validate size/content type
  -> stream request.body into R2.put(), or buffer up to the size cap when Content-Length is absent
  -> index metadata in background if ARTIFACT_INDEX is bound
```

Artifact download:

```txt
GET /v8/artifacts/:artifactId
  -> validate bearer token and read scope
  -> resolve tenant/team/branch
  -> optionally check Cache API
  -> stream R2.get().body to client
  -> optionally fill Cache API in background
```

Artifact metadata:

```txt
HEAD /v8/artifacts/:artifactId
  -> validate bearer token and read scope
  -> R2.head()
  -> return metadata headers without reading object body
```

KV mode uses the same routing and key model, but it is an explicit fallback. KV buffers uploads, caps values at 25 MiB, and cannot do metadata-only `HEAD` without reading the stored value. R2 is recommended for real cache artifacts.

## Storage key design

Default:

```txt
v1/team/{teamKey}/artifact/{artifactId}
```

Branch:

```txt
v1/team/{teamKey}/branch/{branch}/artifact/{artifactId}
```

Design goals:

| Goal             | Why                    |
| ---------------- | ---------------------- |
| versioned prefix | future migration path  |
| team prefix      | cheap team stats/purge |
| branch namespace | optional PR isolation  |
| encoded parts    | safe R2 object keys    |

## Source of truth

R2 is source of truth in the default setup.

Cache API is read acceleration only. D1 artifact index is metadata only. Analytics Engine is observability only.

```txt
R2 artifact exists -> cache hit possible
Cache API entry exists -> faster read path
D1 index row exists -> admin/search metadata
Analytics datapoint exists -> reporting only
```

## Optional Cloudflare products

| Product          | Binding          | Why it is used                                                                            |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| R2               | `ARTIFACTS`      | durable artifact storage with streaming for normal Turbo uploads; default source of truth |
| KV               | `ARTIFACTS_KV`   | explicit small-artifact fallback for simple experiments                                   |
| D1               | `TOKEN_DB`       | dynamic token auth: hashed tokens, teams, scopes, expiry, revocation, audit log           |
| D1               | `ARTIFACT_INDEX` | queryable artifact metadata for admin/search/reporting; not required for cache hits       |
| Cache API        | none             | optional edge acceleration for small repeated reads                                       |
| Analytics Engine | `ANALYTICS`      | non-blocking metrics for hit/miss/status/upload/event traffic                             |
| Rate Limiting    | `RATE_LIMITER`   | optional per-token or per-team request limiting                                           |

Each optional binding can fail closed or be absent without changing the default Worker + R2 cache behavior. Artifact bodies live in R2/KV. Token state lives in D1 only when `TOKEN_DB` is enabled. Metrics live in Analytics Engine only when `ANALYTICS` is bound.

## Why not pre-warm?

Warmup is not a Worker concern. Turbo artifacts are produced by running repo tasks. A Worker cannot checkout a repo or run `pnpm turbo run`. If an on-push build already runs Turbo with remote writes, that build naturally populates the remote cache.
