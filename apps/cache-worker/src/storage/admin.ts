import { appConfig, ArtifactStore } from "../app/env";
import type { Env } from "../app/env";
import { deleteStoredArtifacts } from "./artifacts";
import { ARTIFACT_NAMESPACE_VERSION } from "./constants";
import { deleteIndexedArtifacts } from "./index";
import { kvObjectSize, listKvArtifacts } from "./kv";

export interface TeamStats {
	bytes: number;
	objects: number;
	team: string;
}

export interface PurgeResult {
	deleted: number;
	team: string;
}

const PAGE_LIMIT = 1000;

export async function teamStats(env: Env, team: string): Promise<TeamStats> {
	if (appConfig(env).artifactStore === ArtifactStore.Kv) {
		return kvTeamStats(env, team);
	}

	let cursor: string | undefined;
	let bytes = 0;
	let objects = 0;

	do {
		const listed = await env.ARTIFACTS.list({ cursor, limit: PAGE_LIMIT, prefix: teamPrefix(team) });
		for (const object of listed.objects) {
			bytes += object.size;
			objects += 1;
		}

		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor !== undefined);

	return { bytes, objects, team };
}

export async function purgeTeam(env: Env, team: string, maxDelete = PAGE_LIMIT): Promise<PurgeResult> {
	if (appConfig(env).artifactStore === ArtifactStore.Kv) {
		return purgeKvTeam(env, team, maxDelete);
	}

	let cursor: string | undefined;
	let deleted = 0;

	do {
		const listed = await env.ARTIFACTS.list({ cursor, limit: PAGE_LIMIT, prefix: teamPrefix(team) });
		const selected = listed.objects.map((object) => object.key).slice(0, maxDelete - deleted);

		if (selected.length > 0) {
			await deleteStoredArtifacts(env, selected);
			await deleteIndexedArtifacts(env, selected);
			deleted += selected.length;
		}

		cursor = listed.truncated && deleted < maxDelete ? listed.cursor : undefined;
	} while (cursor !== undefined);

	return { deleted, team };
}

function teamPrefix(team: string): string {
	return `${ARTIFACT_NAMESPACE_VERSION}/team/${encodeURIComponent(team)}/artifact/`;
}

async function kvTeamStats(env: Env, team: string): Promise<TeamStats> {
	let cursor: string | undefined;
	let bytes = 0;
	let objects = 0;

	do {
		const listed = await listKvArtifacts(env, teamPrefix(team), cursor);
		for (const object of listed.objects) {
			bytes += kvObjectSize(object.metadata);
			objects += 1;
		}

		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor !== undefined);

	return { bytes, objects, team };
}

async function purgeKvTeam(env: Env, team: string, maxDelete: number): Promise<PurgeResult> {
	let cursor: string | undefined;
	let deleted = 0;

	do {
		const listed = await listKvArtifacts(env, teamPrefix(team), cursor);
		const selected = listed.objects.map((object) => object.key).slice(0, maxDelete - deleted);

		if (selected.length > 0) {
			await deleteStoredArtifacts(env, selected);
			await deleteIndexedArtifacts(env, selected);
			deleted += selected.length;
		}

		cursor = listed.truncated && deleted < maxDelete ? listed.cursor : undefined;
	} while (cursor !== undefined);

	return { deleted, team };
}
