import { appConfig, type Env } from "../app/env";
import { deleteStoredArtifacts } from "./artifacts";
import { ARTIFACT_NAMESPACE_VERSION } from "./constants";
import { deleteIndexedArtifacts } from "./index";
import { listStoredArtifacts } from "./list";

export interface CleanupResult {
	deleted: number;
	scanned: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function cleanupExpiredArtifacts(env: Env, now = Date.now()): Promise<CleanupResult> {
	const config = appConfig(env);
	if (config.cleanupMaxDelete === 0 || config.retentionDays === 0) {
		return { deleted: 0, scanned: 0 };
	}

	const expiresBefore = new Date(now - config.retentionDays * MS_PER_DAY);
	let cursor: string | undefined;
	let deleted = 0;
	let scanned = 0;

	do {
		const listed = await listStoredArtifacts(env, `${ARTIFACT_NAMESPACE_VERSION}/`, cursor);
		const expired = listed.objects.filter((object) => object.uploaded < expiresBefore).map((object) => object.key);
		const remaining = config.cleanupMaxDelete - deleted;
		const selected = expired.slice(0, remaining);

		scanned += listed.objects.length;

		if (selected.length > 0) {
			await deleteStoredArtifacts(env, selected);
			await deleteIndexedArtifacts(env, selected);
			deleted += selected.length;
		}

		cursor = listed.truncated && deleted < config.cleanupMaxDelete ? listed.cursor : undefined;
	} while (cursor !== undefined);

	return { deleted, scanned };
}
