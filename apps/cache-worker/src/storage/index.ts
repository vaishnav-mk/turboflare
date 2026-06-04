import type { Env } from "../app/env";
import type { AuthContext } from "../auth/types";
import type { TenantContext } from "../tenancy/types";

export interface ArtifactIndexInput {
	artifactId: string;
	authContext: AuthContext;
	customMetadata: Record<string, string>;
	key: string;
	object: R2Object;
	tenant: TenantContext;
}

const DELETE_ARTIFACT_QUERY = "delete from artifact_index where object_key = ?";
const UPSERT_ARTIFACT_QUERY = `insert into artifact_index (object_key, team, artifact_id, size, duration_ms, tag, sha, dirty_hash, token_id, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
on conflict(object_key) do update set team = excluded.team, artifact_id = excluded.artifact_id, size = excluded.size, duration_ms = excluded.duration_ms, tag = excluded.tag, sha = excluded.sha, dirty_hash = excluded.dirty_hash, token_id = excluded.token_id, updated_at = excluded.updated_at`;

export async function indexArtifact(env: Env, input: ArtifactIndexInput): Promise<void> {
	if (env.ARTIFACT_INDEX === undefined) {
		return;
	}

	await env.ARTIFACT_INDEX.prepare(UPSERT_ARTIFACT_QUERY)
		.bind(
			input.key,
			input.tenant.key,
			input.artifactId,
			input.object.size,
			parseDuration(input.customMetadata.duration),
			input.customMetadata.tag ?? null,
			input.customMetadata.sha ?? null,
			input.customMetadata.dirtyHash ?? null,
			input.authContext.tokenId,
			input.customMetadata.createdAt,
			new Date().toISOString()
		)
		.run();
}

export async function deleteIndexedArtifacts(env: Env, keys: readonly string[]): Promise<void> {
	if (env.ARTIFACT_INDEX === undefined || keys.length === 0) {
		return;
	}

	await Promise.all(keys.map((key) => env.ARTIFACT_INDEX?.prepare(DELETE_ARTIFACT_QUERY).bind(key).run()));
}

function parseDuration(value: string | undefined): number {
	if (value === undefined) {
		return 0;
	}

	const duration = Number.parseInt(value, 10);
	return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}
