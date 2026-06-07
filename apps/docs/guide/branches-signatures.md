# Branches & Signatures

Branch policies and signatures are optional. Keep defaults until you know you need them.

## Branch policies

![Branch policy diagram](/diagrams/branch-policy.svg)

Enable with:

```txt
BRANCH_CACHE_POLICY=shared|isolated|main-write-pr-read|read-only-pr
DEFAULT_BRANCH=main
```

Branch sources:

| Source          | Example                          |
| --------------- | -------------------------------- |
| query param     | `?branch=feature-x`              |
| header          | `x-turboflare-branch: feature-x` |
| team convention | `TURBO_TEAM=my-team@feature-x`   |

Explicit query/header branch wins over `team@branch`.

## Policy behavior

| Policy               | Writes              | Reads                          | Use when                               |
| -------------------- | ------------------- | ------------------------------ | -------------------------------------- |
| `shared`             | default team key    | default team key               | you want maximum reuse                 |
| `isolated`           | branch key          | same branch key                | branches must not share artifacts      |
| `main-write-pr-read` | branch key for PRs  | branch key, then main fallback | PRs can reuse main but keep own writes |
| `read-only-pr`       | default branch only | PRs read main                  | untrusted PRs should not write         |

## Branch retention

Set:

```txt
BRANCH_RETENTION_DAYS=7
```

This only affects Worker cleanup. R2 lifecycle applies one bucket-level age rule to the full `v1/` prefix.

## Signed remote cache

Turbo can sign cache artifacts. Turboflare preserves the signed tag header and can reject unsigned uploads.

Server:

```txt
SIGNATURE_POLICY=require
```

Turbo client:

```json
{
  "remoteCache": {
    "signature": true
  }
}
```

Environment:

```sh
export TURBO_REMOTE_CACHE_SIGNATURE_KEY="..."
```

## Signature policy modes

| Mode      | Behavior                                |
| --------- | --------------------------------------- |
| `off`     | no signature checks                     |
| `accept`  | preserve signed metadata when present   |
| `monitor` | emit metric when upload is unsigned     |
| `require` | reject uploads missing `x-artifact-tag` |

`require` checks for the Turbo signature tag. Turbo clients still verify signed artifacts when restoring them.
