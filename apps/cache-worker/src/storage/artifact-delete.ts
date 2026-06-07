import { appConfig, ArtifactStore, type Env } from "../app/env";
import { deleteCachedArtifacts } from "./cache-api";
import { deleteKvArtifacts } from "./kv";

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
