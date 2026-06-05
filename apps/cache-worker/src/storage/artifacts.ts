import type { ArtifactLookupResponse } from "@turboflare/protocol";
import { errorResponse, jsonResponse } from "@turboflare/shared";

import { appConfig, ArtifactStore, type Env } from "../app/env";
import { mapWithConcurrency } from "../shared/concurrency";
import type { TenantContext } from "../tenancy/types";
import { BATCH_HEAD_CONCURRENCY, MAX_BATCH_HASHES, MAX_KV_VALUE_BYTES } from "./constants";
import { artifactKey } from "./keys";
import { deleteKvArtifacts, getKvArtifact, headKvArtifact, kvObjectSize, kvObjectUploaded, listKvArtifacts, putKvArtifact } from "./kv";
import type { ArtifactBodyObject, ArtifactMetadataObject } from "./metadata";
import { lookupHit } from "./metadata";
import { getR2Artifact, headR2Artifact, putR2Artifact } from "./r2";

export interface ListedStoredArtifact {
	key: string;
	size: number;
	uploaded: Date;
}

export function artifactStoreUnavailable(env: Env): Response | null {
	return appConfig(env).artifactStore === ArtifactStore.Kv && env.ARTIFACTS_KV === undefined ? errorResponse(503, "unavailable", "KV artifact store is not configured") : null;
}

export function kvUploadLimitError(env: Env, contentLength: number | undefined): Response | null {
	const config = appConfig(env);
	if (config.artifactStore !== ArtifactStore.Kv) {
		return null;
	}

	if (contentLength === undefined) {
		return errorResponse(411, "length_required", "KV artifact store requires Content-Length");
	}

	const limit = config.maxArtifactBytes > 0 ? Math.min(config.maxArtifactBytes, MAX_KV_VALUE_BYTES) : MAX_KV_VALUE_BYTES;
	return contentLength > limit ? errorResponse(413, "artifact_too_large", "Artifact upload exceeds configured KV size limit") : null;
}

export function deleteStoredArtifacts(env: Env, keys: readonly string[]): Promise<void> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? deleteKvArtifacts(env, keys) : env.ARTIFACTS.delete([...keys]);
}

export async function listStoredArtifacts(env: Env, prefix: string, cursor?: string, limit?: number): Promise<{ cursor?: string; objects: readonly ListedStoredArtifact[]; truncated: boolean }> {
	if (appConfig(env).artifactStore === ArtifactStore.Kv) {
		const listed = await listKvArtifacts(env, prefix, cursor, limit);
		return {
			cursor: listed.cursor,
			objects: listed.objects.map((object) => ({ key: object.key, size: kvObjectSize(object.metadata), uploaded: kvObjectUploaded(object.metadata) })),
			truncated: listed.truncated,
		};
	}

	const listed = await env.ARTIFACTS.list({ cursor, limit, prefix });
	return {
		cursor: listed.truncated ? listed.cursor : undefined,
		objects: listed.objects.map((object) => ({ key: object.key, size: object.size, uploaded: object.uploaded })),
		truncated: listed.truncated,
	};
}

export function getArtifactObject(env: Env, key: string): Promise<ArtifactBodyObject | R2ObjectBody | null> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? getKvArtifact(env, key) : getR2Artifact(env, key);
}

export function headArtifactObject(env: Env, key: string): Promise<ArtifactMetadataObject | R2Object | null> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? headKvArtifact(env, key) : headR2Artifact(env, key);
}

export async function lookupArtifacts(env: Env, tenant: TenantContext, artifactIds: readonly string[]): Promise<Response> {
	if (artifactIds.length > MAX_BATCH_HASHES) {
		return errorResponse(400, "bad_request", `Artifact lookup supports at most ${MAX_BATCH_HASHES} hashes`);
	}

	const entries = await mapWithConcurrency(artifactIds, BATCH_HEAD_CONCURRENCY, async (artifactId) => {
		const key = artifactKey(tenant, artifactId);
		if (key instanceof Response) {
			return [artifactId, null] as const;
		}

		const object = await headArtifactObject(env, key);
		return [artifactId, object === null ? null : lookupHit(object)] as const;
	});

	return jsonResponse(Object.fromEntries(entries) as ArtifactLookupResponse);
}

export function putArtifactObject(env: Env, key: string, body: ReadableStream, customMetadata: Record<string, string>): Promise<ArtifactMetadataObject | R2Object> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? putKvArtifact(env, key, body, customMetadata) : putR2Artifact(env, key, body, customMetadata);
}
