import type { ArtifactLookupResponse } from "@turboflare/protocol";
import { jsonResponse } from "@turboflare/shared";

import type { Env } from "../app/env";
import { mapWithConcurrency } from "../shared/concurrency";
import type { TenantContext } from "../tenancy/types";
import { MAX_BATCH_HASHES, OCTET_STREAM, R2_BATCH_HEAD_CONCURRENCY } from "./constants";
import { artifactKey } from "./keys";
import { lookupHit } from "./metadata";

export async function putR2Artifact(env: Env, key: string, body: ReadableStream, customMetadata: Record<string, string>): Promise<R2Object> {
	return env.ARTIFACTS.put(key, body, {
		httpMetadata: {
			contentType: OCTET_STREAM,
		},
		customMetadata,
	});
}

export function getR2Artifact(env: Env, key: string): Promise<R2ObjectBody | null> {
	return env.ARTIFACTS.get(key);
}

export function headR2Artifact(env: Env, key: string): Promise<R2Object | null> {
	return env.ARTIFACTS.head(key);
}

export async function lookupR2Artifacts(env: Env, tenant: TenantContext, artifactIds: readonly string[]): Promise<Response> {
	if (artifactIds.length > MAX_BATCH_HASHES) {
		return jsonResponse(
			{
				error: {
					code: "bad_request",
					message: `Artifact lookup supports at most ${MAX_BATCH_HASHES} hashes`,
				},
			},
			{ status: 400 }
		);
	}

	const entries = await mapWithConcurrency(artifactIds, R2_BATCH_HEAD_CONCURRENCY, async (artifactId) => {
		const key = artifactKey(tenant, artifactId);
		if (key instanceof Response) {
			return [artifactId, null] as const;
		}

		const object = await headR2Artifact(env, key);
		return [artifactId, object === null ? null : lookupHit(object)] as const;
	});

	return jsonResponse(Object.fromEntries(entries) as ArtifactLookupResponse);
}
