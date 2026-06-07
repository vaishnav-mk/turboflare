import { appConfig, ArtifactStore, type Env } from "../../app/env";
import { MAX_KV_VALUE_BYTES } from "../constants";

export function artifactUploadLimit(env: Env): number {
  const config = appConfig(env);
  return config.artifactStore === ArtifactStore.Kv && config.maxArtifactBytes > 0
    ? Math.min(config.maxArtifactBytes, MAX_KV_VALUE_BYTES)
    : config.artifactStore === ArtifactStore.Kv
      ? MAX_KV_VALUE_BYTES
      : config.maxArtifactBytes;
}
