import { appConfig, ArtifactStore, type Env } from "../../app/env";
import { getKvArtifact } from "../kv";
import type { ArtifactBodyObject } from "../metadata";

export function getArtifactObject(
  env: Env,
  key: string,
): Promise<ArtifactBodyObject | R2ObjectBody | null> {
  return appConfig(env).artifactStore === ArtifactStore.Kv
    ? getKvArtifact(env, key)
    : env.ARTIFACTS.get(key);
}
