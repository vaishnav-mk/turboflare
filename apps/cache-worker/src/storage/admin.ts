import type { Env } from "../app/env";
import { deleteStoredArtifacts } from "./artifacts";
import { deleteIndexedArtifacts } from "./artifact-index";
import { teamKeyPrefix } from "./keys";
import { listStoredArtifacts } from "./list";

interface TeamStats {
  bytes: number;
  objects: number;
  team: string;
}

interface PurgeResult {
  deleted: number;
  team: string;
  truncated: boolean;
}

const PAGE_LIMIT = 1000;

export async function teamStats(env: Env, team: string): Promise<TeamStats> {
  let cursor: string | undefined;
  let bytes = 0;
  let objects = 0;

  do {
    const prefix = teamKeyPrefix(team);
    const listed = await listStoredArtifacts(env, prefix, cursor, PAGE_LIMIT);
    for (const object of listed.objects) {
      bytes += object.size;
      objects += 1;
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);

  return { bytes, objects, team };
}

export async function purgeTeam(
  env: Env,
  team: string,
  maxDelete = Number.MAX_SAFE_INTEGER,
): Promise<PurgeResult> {
  let cursor: string | undefined;
  let deleted = 0;
  let truncated = false;

  do {
    const prefix = teamKeyPrefix(team);
    const listed = await listStoredArtifacts(env, prefix, cursor, PAGE_LIMIT);
    const objectKeys = listed.objects.map((object) => object.key);
    const remainingDeleteBudget = maxDelete - deleted;
    const selected = objectKeys.slice(0, remainingDeleteBudget);

    if (selected.length > 0) {
      const deletedKeys = await deleteStoredArtifacts(env, selected);
      await deleteIndexedArtifacts(env, deletedKeys);
      deleted += deletedKeys.length;
    }

    truncated =
      selected.length < listed.objects.length || (listed.truncated && deleted >= maxDelete);
    cursor = listed.truncated && deleted < maxDelete ? listed.cursor : undefined;
  } while (cursor !== undefined);

  return { deleted, team, truncated };
}
