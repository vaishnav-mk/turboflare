import { appConfig, ArtifactStore, type Env } from "../app/env";
import { ErrorCode, errorResponse } from "../http/response";
import { MAX_KV_VALUE_BYTES } from "./constants";
import { deleteKvArtifacts, getKvArtifact, headKvArtifact, putKvArtifact } from "./kv";
import type { ArtifactBodyObject, ArtifactMetadataObject } from "./metadata";
import { getR2Artifact, headR2Artifact, putR2Artifact } from "./r2";
import { deleteCachedArtifacts } from "./cache-api";

export function artifactStoreUnavailable(env: Env): Response | null {
  return appConfig(env).artifactStore === ArtifactStore.Kv && env.ARTIFACTS_KV === undefined
    ? errorResponse(503, ErrorCode.Unavailable, "KV artifact store is not configured")
    : null;
}

export function artifactUploadLimit(env: Env): number {
  const config = appConfig(env);
  return config.artifactStore === ArtifactStore.Kv && config.maxArtifactBytes > 0
    ? Math.min(config.maxArtifactBytes, MAX_KV_VALUE_BYTES)
    : config.artifactStore === ArtifactStore.Kv
      ? MAX_KV_VALUE_BYTES
      : config.maxArtifactBytes;
}

export async function deleteStoredArtifacts(
  env: Env,
  keys: readonly string[],
): Promise<readonly string[]> {
  if (keys.length === 0) {
    return [];
  }

  if (appConfig(env).artifactStore === ArtifactStore.Kv) {
    const deleted = await deleteKvArtifacts(env, keys);

    await deleteCachedArtifacts(deleted);
    return deleted;
  }

  await env.ARTIFACTS.delete([...keys]);
  await deleteCachedArtifacts(keys);
  return keys;
}

export function getArtifactObject(
  env: Env,
  key: string,
): Promise<ArtifactBodyObject | R2ObjectBody | null> {
  return appConfig(env).artifactStore === ArtifactStore.Kv
    ? getKvArtifact(env, key)
    : getR2Artifact(env, key);
}

export function headArtifactObject(
  env: Env,
  key: string,
): Promise<ArtifactMetadataObject | R2Object | null> {
  return appConfig(env).artifactStore === ArtifactStore.Kv
    ? headKvArtifact(env, key)
    : headR2Artifact(env, key);
}

export function putArtifactObject(
  env: Env,
  key: string,
  body: ReadableStream,
  customMetadata: Record<string, string>,
): Promise<ArtifactMetadataObject | R2Object> {
  return appConfig(env).artifactStore === ArtifactStore.Kv
    ? putKvArtifact(env, key, body, customMetadata)
    : putR2Artifact(env, key, body, customMetadata);
}
