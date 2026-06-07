import { appConfig, type Env } from "../app/env";
import { deleteStoredArtifacts } from "./artifact/delete";
import { ARTIFACT_NAMESPACE_VERSION } from "./constants";
import { deleteIndexedArtifacts } from "./artifact/index";
import { listStoredArtifacts } from "./list";

interface CleanupResult {
  deleted: number;
  scanned: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function cleanupExpiredArtifacts(env: Env, now?: number): Promise<CleanupResult> {
  const cleanupTime = now ?? Date.now();
  const config = appConfig(env);
  if (config.cleanupMaxDelete === 0 || config.retentionDays === 0) {
    return { deleted: 0, scanned: 0 };
  }

  const artifactExpiresBefore = new Date(cleanupTime - config.retentionDays * MS_PER_DAY);
  const branchExpiresBefore =
    config.branchRetentionDays === 0
      ? new Date(0)
      : new Date(cleanupTime - config.branchRetentionDays * MS_PER_DAY);
  let deleted = 0;
  let scanned = 0;

  async function cleanupPage(cursor?: string): Promise<void> {
    const listed = await listStoredArtifacts(env, `${ARTIFACT_NAMESPACE_VERSION}/`, cursor);
    const expired = listed.objects
      .filter(
        (object) =>
          object.uploaded <
          (object.key.includes("/branch/") ? branchExpiresBefore : artifactExpiresBefore),
      )
      .map((object) => object.key);
    const remaining = config.cleanupMaxDelete - deleted;
    const selected = expired.slice(0, remaining);

    scanned += listed.objects.length;

    if (selected.length > 0) {
      const deletedKeys = await deleteStoredArtifacts(env, selected);
      await deleteIndexedArtifacts(env, deletedKeys);
      deleted += deletedKeys.length;
    }

    if (listed.truncated && deleted < config.cleanupMaxDelete && listed.cursor !== undefined) {
      await cleanupPage(listed.cursor);
    }
  }
  await cleanupPage();

  return { deleted, scanned };
}
