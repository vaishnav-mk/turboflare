import type { Env } from "../app/env";
import type { AuthContext } from "../auth/types";
import { parseDurationMs } from "../shared/duration";
import type { TenantContext } from "../tenancy/types";
import type { ArtifactMetadataObject } from "./metadata";

interface ArtifactIndexInput {
  artifactId: string;
  authContext: AuthContext;
  customMetadata: Record<string, string>;
  key: string;
  object: ArtifactMetadataObject;
  tenant: TenantContext;
}

const DELETE_ARTIFACT_QUERY = "delete from artifact_index where object_key = ?";
const UPSERT_ARTIFACT_QUERY = `insert into artifact_index (object_key, team, artifact_id, size, duration_ms, tag, sha, dirty_hash, token_id, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
on conflict(object_key) do update set team = excluded.team, artifact_id = excluded.artifact_id, size = excluded.size, duration_ms = excluded.duration_ms, tag = excluded.tag, sha = excluded.sha, dirty_hash = excluded.dirty_hash, token_id = excluded.token_id, updated_at = excluded.updated_at`;

export async function indexArtifact(env: Env, input: ArtifactIndexInput): Promise<void> {
  if (env.ARTIFACT_INDEX === undefined) {
    return;
  }

  const durationMs = parseDurationMs(input.customMetadata.duration);
  const updatedAt = new Date();
  await env.ARTIFACT_INDEX.prepare(UPSERT_ARTIFACT_QUERY)
    .bind(
      input.key,
      input.tenant.key,
      input.artifactId,
      input.object.size,
      durationMs,
      input.customMetadata.tag ?? null,
      input.customMetadata.sha ?? null,
      input.customMetadata.dirtyHash ?? null,
      input.authContext.tokenId,
      input.customMetadata.createdAt,
      updatedAt.toISOString(),
    )
    .run();
}

export async function deleteIndexedArtifacts(env: Env, keys: readonly string[]): Promise<void> {
  if (env.ARTIFACT_INDEX === undefined || keys.length === 0) {
    return;
  }

  const statements = keys.map((key) => {
    const statement = env.ARTIFACT_INDEX!.prepare(DELETE_ARTIFACT_QUERY);
    return statement.bind(key);
  });
  await env.ARTIFACT_INDEX.batch(statements);
}
