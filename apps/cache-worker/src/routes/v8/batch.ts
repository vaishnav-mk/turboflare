import { type ArtifactLookupRequest, HttpMethod } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { errorResponse, methodNotAllowed } from "../../http/response";
import { artifactStoreUnavailable } from "../../storage/artifacts";
import { lookupArtifacts } from "../../storage/lookup";
import type { TenantContext } from "../../tenancy/types";

export async function handleArtifactLookup(request: Request, env: Env, tenant: TenantContext): Promise<Response> {
	if (request.method !== HttpMethod.Post) {
		return methodNotAllowed([HttpMethod.Post, HttpMethod.Options]);
	}

	const payload = await readLookupRequest(request);
	if (payload instanceof Response) {
		return payload;
	}

	const storeError = artifactStoreUnavailable(env);
	return storeError ?? lookupArtifacts(env, tenant, payload.hashes);
}

async function readLookupRequest(request: Request): Promise<ArtifactLookupRequest | Response> {
	try {
		const body = await request.json<unknown>();
		if (!isLookupRequest(body)) {
			return errorResponse(400, "bad_request", "Artifact lookup request must be { hashes: string[] }");
		}

		return body;
	} catch {
		return errorResponse(400, "bad_request", "Artifact lookup request body must be JSON");
	}
}

function isLookupRequest(value: unknown): value is ArtifactLookupRequest {
	if (typeof value !== "object" || value === null || !("hashes" in value)) {
		return false;
	}

	const hashes = (value as { hashes: unknown }).hashes;
	return Array.isArray(hashes) && hashes.every((hash) => typeof hash === "string" && hash.length > 0);
}
