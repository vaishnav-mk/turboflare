export interface TokenAdminRow {
  expires_at: string | null;
  id: string;
  revoked_at: string | null;
  scopes: string;
  teams: string;
  token_hash: string;
}

export interface TokenAuditRow {
  action: string;
  created_at: string;
  id: string;
  token_id: string;
}

interface ArtifactIndexRow {
  artifact_id: string;
  created_at: string;
  dirty_hash: string | null;
  duration_ms: number;
  object_key: string;
  sha: string | null;
  size: number;
  tag: string | null;
  team: string;
  token_id: string;
  updated_at: string;
}

export class ArtifactIndexDb {
  readonly rows = new Map<string, ArtifactIndexRow>();

  prepare(query: string): D1PreparedStatement {
    return {
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (query.startsWith("insert")) {
            const [
              objectKey,
              team,
              artifactId,
              size,
              durationMs,
              tag,
              sha,
              dirtyHash,
              tokenId,
              createdAt,
              updatedAt,
            ] = values as [
              string,
              string,
              string,
              number,
              number,
              string | null,
              string | null,
              string | null,
              string,
              string,
              string,
            ];
            this.rows.set(objectKey, {
              artifact_id: artifactId,
              created_at: createdAt,
              dirty_hash: dirtyHash,
              duration_ms: durationMs,
              object_key: objectKey,
              sha,
              size,
              tag,
              team,
              token_id: tokenId,
              updated_at: updatedAt,
            });
          }

          if (query.startsWith("delete")) {
            this.rows.delete(values[0] as string);
          }

          return { success: true };
        },
      }),
    } as unknown as D1PreparedStatement;
  }
}

export class ThrowingD1 {
  prepare(): D1PreparedStatement {
    return {
      bind: () => ({
        run: async () => {
          throw new Error("d1 down");
        },
      }),
    } as unknown as D1PreparedStatement;
  }
}

interface RouteCleanupObject {
  key: string;
  uploaded: Date;
}

export class RouteCleanupBucket {
  readonly deleted: string[] = [];

  constructor(private readonly objects: RouteCleanupObject[]) {}

  async list(options: R2ListOptions): Promise<R2Objects> {
    const filtered = this.objects.filter((object) => object.key.startsWith(options.prefix ?? ""));
    return {
      delimitedPrefixes: [],
      objects: filtered.map((object) => ({
        checksums: {} as R2Checksums,
        etag: object.key,
        httpEtag: `"${object.key}"`,
        key: object.key,
        size: 1,
        storageClass: "Standard",
        uploaded: object.uploaded,
        version: object.key,
        writeHttpMetadata() {},
      })) as unknown as R2Object[],
      truncated: false,
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    this.deleted.push(...(Array.isArray(keys) ? keys : [keys]));
  }
}

export class HeadOnlyBucket {
  getCalls = 0;
  headCalls = 0;

  constructor(private readonly key: string) {}

  async get(): Promise<R2ObjectBody | null> {
    this.getCalls += 1;
    throw new Error("HEAD must not call get");
  }

  async head(key: string): Promise<R2Object | null> {
    this.headCalls += 1;
    if (key !== this.key) {
      return null;
    }

    return {
      checksums: {} as R2Checksums,
      customMetadata: { duration: "4" },
      etag: key,
      httpEtag: `"${key}"`,
      httpMetadata: { contentType: "application/octet-stream" },
      key,
      size: 4,
      storageClass: "Standard",
      uploaded: new Date(0),
      version: key,
      writeHttpMetadata() {},
    } as unknown as R2Object;
  }
}

interface MemoryKVEntry {
  body: Uint8Array;
  metadata?: unknown;
}

export class MemoryKV {
  readonly entries = new Map<string, MemoryKVEntry>();

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async getWithMetadata<Metadata>(
    key: string,
  ): Promise<{ metadata: Metadata | null; value: ReadableStream | null }> {
    const entry = this.entries.get(key);
    const body = entry?.body.buffer.slice(
      entry.body.byteOffset,
      entry.body.byteOffset + entry.body.byteLength,
    ) as ArrayBuffer | undefined;
    return entry === undefined || body === undefined
      ? { metadata: null, value: null }
      : { metadata: (entry.metadata ?? null) as Metadata | null, value: new Response(body).body };
  }

  async list<Metadata>(
    options: KVNamespaceListOptions,
  ): Promise<KVNamespaceListResult<Metadata, string>> {
    const keys = [...this.entries.entries()]
      .filter(([key]) => key.startsWith(options.prefix ?? ""))
      .map(([name, entry]) => ({ name, metadata: entry.metadata as Metadata }));

    return { cacheStatus: null, cursor: "", keys, list_complete: true } as KVNamespaceListResult<
      Metadata,
      string
    >;
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: KVNamespacePutOptions,
  ): Promise<void> {
    const body =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    this.entries.set(key, { body, metadata: options?.metadata });
  }
}

export function kvMetadata(metadata: Record<string, string>, size: number): Record<string, string> {
  return {
    ...metadata,
    httpEtag: `"${crypto.randomUUID()}"`,
    size: size.toString(),
    uploaded: new Date().toISOString(),
  };
}

export class TokenAdminDb {
  readonly audit: TokenAuditRow[] = [];
  readonly rows = new Map<string, TokenAdminRow>();

  prepare(query: string): D1PreparedStatement {
    return {
      all: async () => ({
        results: [...this.rows.values()].sort((left, right) => left.id.localeCompare(right.id)),
      }),
      bind: (...values: unknown[]) => ({
        all: async () => ({
          results: [...this.rows.values()].sort((left, right) => left.id.localeCompare(right.id)),
        }),
        first: async () => null,
        run: async () => {
          let changes = 0;
          if (query.startsWith("insert")) {
            if (query.includes("token_audit")) {
              const [id, tokenId, action, createdAt] = values as [string, string, string, string];
              this.audit.push({ action, created_at: createdAt, id, token_id: tokenId });
              changes = 1;
            } else {
              const [id, tokenHash, teams, scopes, expiresAt] = values as [
                string,
                string,
                string,
                string,
                string | null,
              ];
              if (
                this.rows.has(id) ||
                [...this.rows.values()].some((row) => row.token_hash === tokenHash)
              ) {
                throw new Error("UNIQUE constraint failed: tokens.id");
              }
              this.rows.set(id, {
                expires_at: expiresAt,
                id,
                revoked_at: null,
                scopes,
                teams,
                token_hash: tokenHash,
              });
              changes = 1;
            }
          }

          if (query.startsWith("update")) {
            const [revokedAt, id] = values as [string, string];
            const row = this.rows.get(id);
            if (row !== undefined && row.revoked_at === null) {
              row.revoked_at = revokedAt;
              changes = 1;
            }
          }

          return { meta: { changes }, success: true };
        },
      }),
    } as unknown as D1PreparedStatement;
  }
}
