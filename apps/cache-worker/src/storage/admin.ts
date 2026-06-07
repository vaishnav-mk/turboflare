import type { Env } from "../app/env";
import { deleteStoredArtifacts } from "./artifact/store";
import { deleteIndexedArtifacts } from "./artifact/index";
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
  const prefix = teamKeyPrefix(team);
  let bytes = 0;
  let objects = 0;

  async function addPage(cursor?: string): Promise<void> {
    const listed = await listStoredArtifacts(env, prefix, cursor, PAGE_LIMIT);
    for (const object of listed.objects) {
      bytes += object.size;
      objects += 1;
    }

    if (listed.truncated && listed.cursor !== undefined) {
      await addPage(listed.cursor);
    }
  }
  await addPage();

  return { bytes, objects, team };
}

export async function purgeTeam(
  env: Env,
  team: string,
  maxDelete = Number.MAX_SAFE_INTEGER,
): Promise<PurgeResult> {
  const prefix = teamKeyPrefix(team);
  let deleted = 0;
  let truncated = false;

  async function purgePage(cursor?: string): Promise<void> {
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
    if (listed.truncated && deleted < maxDelete && listed.cursor !== undefined) {
      await purgePage(listed.cursor);
    }
  }
  await purgePage();

  return { deleted, team, truncated };
}
