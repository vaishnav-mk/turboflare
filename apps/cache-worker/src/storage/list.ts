import { appConfig, ArtifactStore, type Env } from "../app/env";
import { kvObjectSize, kvObjectUploaded, listKvArtifacts } from "./kv";

interface ListedStoredArtifact {
  key: string;
  size: number;
  uploaded: Date;
}

interface ListedStoredArtifacts {
  cursor?: string;
  objects: readonly ListedStoredArtifact[];
  truncated: boolean;
}

export async function listStoredArtifacts(
  env: Env,
  prefix: string,
  cursor?: string,
  limit?: number,
): Promise<ListedStoredArtifacts> {
  if (appConfig(env).artifactStore === ArtifactStore.Kv) {
    const listed = await listKvArtifacts(env, prefix, cursor, limit);
    return {
      cursor: listed.cursor,
      objects: listed.objects.map((object) => ({
        key: object.key,
        size: kvObjectSize(object.metadata),
        uploaded: kvObjectUploaded(object.metadata),
      })),
      truncated: listed.truncated,
    };
  }

  const listed = await env.ARTIFACTS.list({ cursor, limit, prefix });
  return {
    cursor: listed.truncated ? listed.cursor : undefined,
    objects: listed.objects.map((object) => ({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded,
    })),
    truncated: listed.truncated,
  };
}
