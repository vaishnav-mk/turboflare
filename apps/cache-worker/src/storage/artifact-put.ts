import { appConfig, ArtifactStore, type Env } from "../app/env";
import { OCTET_STREAM } from "./constants";
import { putKvArtifact } from "./kv";
import type { ArtifactMetadataObject } from "./metadata";

export function putArtifactObject(
  env: Env,
  key: string,
  body: ReadableStream,
  customMetadata: Record<string, string>,
): Promise<ArtifactMetadataObject | R2Object> {
  return appConfig(env).artifactStore === ArtifactStore.Kv
    ? putKvArtifact(env, key, body, customMetadata)
    : env.ARTIFACTS.put(key, body, {
        httpMetadata: { contentType: OCTET_STREAM },
        customMetadata,
      });
}
