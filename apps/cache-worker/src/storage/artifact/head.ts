import { appConfig, ArtifactStore, type Env } from "../../app/env";
import { headKvArtifact } from "../kv";
import type { ArtifactMetadataObject } from "../metadata";

export function headArtifactObject(
  env: Env,
  key: string,
): Promise<ArtifactMetadataObject | R2Object | null> {
  return appConfig(env).artifactStore === ArtifactStore.Kv
    ? headKvArtifact(env, key)
    : env.ARTIFACTS.head(key);
}
