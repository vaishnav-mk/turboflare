import { HttpMethod } from "@turboflare/protocol";
import { errorResponse, jsonResponse, methodNotAllowed } from "@turboflare/shared";

import { appConfig, type Env } from "../../app/env";
import type { AuthContext } from "../../auth/types";
import { artifactKey } from "../../storage/keys";
import { artifactCustomMetadata, artifactResponseHeaders } from "../../storage/metadata";
import { getR2Artifact, headR2Artifact, putR2Artifact } from "../../storage/r2";
import type { TenantContext } from "../../tenancy/types";

export async function handleArtifact(request: Request, env: Env, tenant: TenantContext, artifactId: string, authContext: AuthContext): Promise<Response> {
	if (request.method === HttpMethod.Put) {
		return putArtifact(request, env, tenant, artifactId, authContext);
	}

	if (request.method === HttpMethod.Get) {
		return getArtifact(env, tenant, artifactId);
	}

	if (request.method === HttpMethod.Head) {
		return headArtifact(env, tenant, artifactId);
	}

	return methodNotAllowed([HttpMethod.Get, HttpMethod.Head, HttpMethod.Put, HttpMethod.Options]);
}

async function putArtifact(request: Request, env: Env, tenant: TenantContext, artifactId: string, authContext: AuthContext): Promise<Response> {
	if (appConfig(env).readOnly) {
		return errorResponse(403, "forbidden", "Remote cache is running in read-only mode");
	}

	if (request.body === null) {
		return errorResponse(400, "bad_request", "Artifact upload requires a request body");
	}

	const key = artifactKey(tenant, artifactId);
	if (key instanceof Response) {
		return key;
	}

	const customMetadata = artifactCustomMetadata(request, new URL(request.url), tenant, artifactId, authContext);
	if (customMetadata instanceof Response) {
		return customMetadata;
	}

	await putR2Artifact(env, key, request.body, customMetadata);
	return jsonResponse({ urls: [] });
}

async function getArtifact(env: Env, tenant: TenantContext, artifactId: string): Promise<Response> {
	const key = artifactKey(tenant, artifactId);
	if (key instanceof Response) {
		return key;
	}

	const object = await getR2Artifact(env, key);
	if (object === null) {
		return new Response(null, { status: 404 });
	}

	return new Response(object.body, {
		headers: artifactResponseHeaders(object),
	});
}

async function headArtifact(env: Env, tenant: TenantContext, artifactId: string): Promise<Response> {
	const key = artifactKey(tenant, artifactId);
	if (key instanceof Response) {
		return key;
	}

	const object = await headR2Artifact(env, key);
	if (object === null) {
		return new Response(null, { status: 404 });
	}

	return new Response(null, {
		headers: artifactResponseHeaders(object),
	});
}
