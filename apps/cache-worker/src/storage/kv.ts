import type { Env } from "../app/env";
import { mapWithConcurrency } from "../shared/concurrency";
import { sha256Hex } from "../shared/hash";
import type { TenantContext } from "../tenancy/types";
import { MAX_BATCH_HASHES, OCTET_STREAM, R2_BATCH_HEAD_CONCURRENCY } from "./constants";
import { artifactKey } from "./keys";
import type { ArtifactBodyObject, ArtifactMetadataObject } from "./metadata";
import { lookupHit } from "./metadata";
import { jsonResponse } from "@turboflare/shared";

interface KvArtifactMetadata extends Record<string, string> {
	httpEtag: string;
	size: string;
	uploaded: string;
}

export interface KvListedArtifact {
	key: string;
	metadata: KvArtifactMetadata;
}

export async function putKvArtifact(env: Env, key: string, body: ReadableStream, customMetadata: Record<string, string>): Promise<ArtifactMetadataObject> {
	const bytes = await new Response(body).arrayBuffer();
	const metadata: KvArtifactMetadata = {
		...customMetadata,
		httpEtag: `"${await sha256Hex(bytes)}"`,
		size: bytes.byteLength.toString(),
		uploaded: new Date().toISOString(),
	};

	await env.ARTIFACTS_KV?.put(key, bytes, { metadata });
	return kvMetadataObject(metadata);
}

export async function getKvArtifact(env: Env, key: string): Promise<ArtifactBodyObject | null> {
	const result = await env.ARTIFACTS_KV?.getWithMetadata<KvArtifactMetadata>(key, { type: "stream" });
	if (result === undefined || result.value === null || result.metadata === null) {
		return null;
	}

	return { ...kvMetadataObject(result.metadata), body: result.value };
}

export async function headKvArtifact(env: Env, key: string): Promise<ArtifactMetadataObject | null> {
	const result = await env.ARTIFACTS_KV?.getWithMetadata<KvArtifactMetadata>(key, { type: "stream" });
	if (result === undefined || result.value === null || result.metadata === null) {
		return null;
	}

	return kvMetadataObject(result.metadata);
}

export async function lookupKvArtifacts(env: Env, tenant: TenantContext, artifactIds: readonly string[]): Promise<Response> {
	if (artifactIds.length > MAX_BATCH_HASHES) {
		return jsonResponse({ error: { code: "bad_request", message: `Artifact lookup supports at most ${MAX_BATCH_HASHES} hashes` } }, { status: 400 });
	}

	const entries = await mapWithConcurrency(artifactIds, R2_BATCH_HEAD_CONCURRENCY, async (artifactId) => {
		const key = artifactKey(tenant, artifactId);
		if (key instanceof Response) {
			return [artifactId, null] as const;
		}

		const object = await headKvArtifact(env, key);
		return [artifactId, object === null ? null : lookupHit(object)] as const;
	});

	return jsonResponse(Object.fromEntries(entries));
}

export async function listKvArtifacts(env: Env, prefix: string, cursor?: string): Promise<{ cursor?: string; objects: readonly KvListedArtifact[]; truncated: boolean }> {
	const result = await env.ARTIFACTS_KV?.list<KvArtifactMetadata>({ cursor, limit: 1000, prefix });
	if (result === undefined) {
		return { objects: [], truncated: false };
	}

	return {
		cursor: result.list_complete ? undefined : result.cursor,
		objects: result.keys.flatMap((key) => (key.metadata === undefined ? [] : [{ key: key.name, metadata: key.metadata }])),
		truncated: !result.list_complete,
	};
}

export async function deleteKvArtifacts(env: Env, keys: readonly string[]): Promise<void> {
	await Promise.all(keys.map((key) => env.ARTIFACTS_KV?.delete(key)));
}

export function kvObjectSize(metadata: KvArtifactMetadata): number {
	const size = Number.parseInt(metadata.size, 10);
	return Number.isFinite(size) && size >= 0 ? size : 0;
}

export function kvObjectUploaded(metadata: KvArtifactMetadata): Date {
	const uploaded = Date.parse(metadata.uploaded);
	return Number.isFinite(uploaded) ? new Date(uploaded) : new Date(0);
}

function kvMetadataObject(metadata: KvArtifactMetadata): ArtifactMetadataObject {
	return {
		customMetadata: metadata,
		httpEtag: metadata.httpEtag,
		httpMetadata: { contentType: OCTET_STREAM },
		size: kvObjectSize(metadata),
		uploaded: kvObjectUploaded(metadata),
	};
}
