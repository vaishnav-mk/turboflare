import { appConfig, ArtifactStore, type Env } from "../app/env";
import { deleteStoredArtifacts } from "./artifacts";
import { ARTIFACT_NAMESPACE_VERSION } from "./constants";
import { deleteIndexedArtifacts } from "./index";
import { kvObjectUploaded, listKvArtifacts } from "./kv";

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

	if (config.artifactStore === ArtifactStore.Kv) {
		return cleanupExpiredKvArtifacts(env, config.cleanupMaxDelete, config.retentionDays, now);
	}

	const expiresBefore = new Date(now - config.retentionDays * MS_PER_DAY);
	let cursor: string | undefined;
	let deleted = 0;
	let scanned = 0;

	do {
		const listed = await env.ARTIFACTS.list({ cursor, prefix: `${ARTIFACT_NAMESPACE_VERSION}/` });
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

async function cleanupExpiredKvArtifacts(env: Env, maxDelete: number, retentionDays: number, now: number): Promise<CleanupResult> {
	const expiresBefore = new Date(now - retentionDays * MS_PER_DAY);
	let cursor: string | undefined;
	let deleted = 0;
	let scanned = 0;

	do {
		const listed = await listKvArtifacts(env, `${ARTIFACT_NAMESPACE_VERSION}/`, cursor);
		const expired = listed.objects.filter((object) => kvObjectUploaded(object.metadata) < expiresBefore).map((object) => object.key);
		const selected = expired.slice(0, maxDelete - deleted);

		scanned += listed.objects.length;

		if (selected.length > 0) {
			await deleteStoredArtifacts(env, selected);
			await deleteIndexedArtifacts(env, selected);
			deleted += selected.length;
		}

		cursor = listed.truncated && deleted < maxDelete ? listed.cursor : undefined;
	} while (cursor !== undefined);

	return { deleted, scanned };
}
