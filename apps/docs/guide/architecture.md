# Architecture

Turboflare keeps the hot path intentionally small: authenticate, resolve tenant, construct a storage key, stream R2.

![Turboflare request flow](/diagrams/request-flow.svg)

## Modules

| Module | Responsibility |
| --- | --- |
| `app/router.ts` | route dispatch and shared `/v8` auth flow |
| `auth/*` | static tokens, scoped tokens, D1 token auth, internal admin auth |
| `tenancy/*` | team and branch resolution |
| `routes/v8/*` | Turbo protocol endpoints |
| `storage/*` | R2/KV storage, keys, metadata, cleanup, D1 index |
| `observability/*` | Analytics Engine datapoints |
| `rate-limit/*` | optional Rate Limiting binding enforcement |
| `routes/internal/*` | admin stats, purge, token management, cleanup |

## Hot path

Artifact upload:

```txt
PUT /v8/artifacts/:artifactId
  -> validate bearer token and write scope
  -> resolve tenant/team/branch
  -> enforce read-only and signature policy
  -> validate size/content type
  -> stream request.body into R2.put()
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

| Goal | Why |
| --- | --- |
| versioned prefix | future migration path |
| team prefix | cheap team stats/purge |
| branch namespace | optional PR isolation |
| encoded parts | safe R2 object keys |

## Source of truth

R2 is source of truth in the default setup.

Cache API is read acceleration only. D1 artifact index is metadata only. Analytics Engine is observability only.

```txt
R2 artifact exists -> cache hit possible
Cache API entry exists -> faster read path
D1 index row exists -> admin/search metadata
Analytics datapoint exists -> reporting only
```

## Why not pre-warm?

Warmup is not a Worker concern. Turbo artifacts are produced by running repo tasks. A Worker cannot checkout a repo or run `pnpm turbo run`. If an on-push build already runs Turbo with remote writes, that build naturally populates the remote cache.
