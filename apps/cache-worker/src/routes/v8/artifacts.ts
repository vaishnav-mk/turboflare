import { HttpMethod } from "@turboflare/protocol";
import { errorResponse, jsonResponse, methodNotAllowed } from "@turboflare/shared";

import { appConfig, type Env } from "../../app/env";
import type { AuthContext } from "../../auth/types";
import { recordMetric } from "../../observability/metrics";
import { MetricEvent } from "../../observability/types";
import { artifactCache, cacheableResponse, cacheRequest } from "../../storage/cache-api";
import { artifactKey } from "../../storage/keys";
import { artifactCustomMetadata, artifactResponseHeaders } from "../../storage/metadata";
import { getR2Artifact, headR2Artifact, putR2Artifact } from "../../storage/r2";
import type { TenantContext } from "../../tenancy/types";

export async function handleArtifact(request: Request, env: Env, ctx: ExecutionContext, tenant: TenantContext, artifactId: string, authContext: AuthContext): Promise<Response> {
	if (request.method === HttpMethod.Put) {
		return putArtifact(request, env, ctx, tenant, artifactId, authContext);
	}

	if (request.method === HttpMethod.Get) {
		return getArtifact(env, ctx, tenant, artifactId);
	}

	if (request.method === HttpMethod.Head) {
		return headArtifact(env, ctx, tenant, artifactId);
	}

	return methodNotAllowed([HttpMethod.Get, HttpMethod.Head, HttpMethod.Put, HttpMethod.Options]);
}

async function putArtifact(request: Request, env: Env, ctx: ExecutionContext, tenant: TenantContext, artifactId: string, authContext: AuthContext): Promise<Response> {
	if (appConfig(env).readOnly) {
		return errorResponse(403, "forbidden", "Remote cache is running in read-only mode");
	}

	const contentType = request.headers.get("Content-Type");
	if (contentType !== null && contentType.toLowerCase() !== "application/octet-stream") {
		return errorResponse(400, "bad_request", "Artifact upload must use application/octet-stream");
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
	recordMetric(env, ctx, { artifactId, event: MetricEvent.Put, method: request.method, status: 200, tenant: tenant.key, tokenId: authContext.tokenId });
	return jsonResponse({ urls: [] });
}

async function getArtifact(env: Env, ctx: ExecutionContext, tenant: TenantContext, artifactId: string): Promise<Response> {
	const key = artifactKey(tenant, artifactId);
	if (key instanceof Response) {
		return key;
	}

	const config = appConfig(env);
	if (config.cacheApiReads) {
		const cached = await artifactCache().match(cacheRequest(key));
		if (cached !== undefined) {
			recordMetric(env, ctx, { artifactId, bytes: numberHeader(cached.headers.get("Content-Length")), event: MetricEvent.GetHit, method: HttpMethod.Get, status: 200, tenant: tenant.key });
			return cached;
		}
	}

	const object = await getR2Artifact(env, key);
	if (object === null) {
		recordMetric(env, ctx, { artifactId, event: MetricEvent.GetMiss, method: HttpMethod.Get, status: 404, tenant: tenant.key });
		return new Response(null, { status: 404 });
	}

	const response = new Response(object.body, {
		headers: artifactResponseHeaders(object),
	});

	if (config.cacheApiReads && object.size <= config.cacheApiMaxBytes) {
		ctx.waitUntil(artifactCache().put(cacheRequest(key), cacheableResponse(response.clone(), key)));
	}

	recordMetric(env, ctx, { artifactId, bytes: object.size, event: MetricEvent.GetHit, method: HttpMethod.Get, status: 200, tenant: tenant.key });
	return response;
}

async function headArtifact(env: Env, ctx: ExecutionContext, tenant: TenantContext, artifactId: string): Promise<Response> {
	const key = artifactKey(tenant, artifactId);
	if (key instanceof Response) {
		return key;
	}

	const object = await headR2Artifact(env, key);
	if (object === null) {
		recordMetric(env, ctx, { artifactId, event: MetricEvent.HeadMiss, method: HttpMethod.Head, status: 404, tenant: tenant.key });
		return new Response(null, { status: 404 });
	}

	recordMetric(env, ctx, { artifactId, bytes: object.size, event: MetricEvent.HeadHit, method: HttpMethod.Head, status: 200, tenant: tenant.key });
	return new Response(null, {
		headers: artifactResponseHeaders(object),
	});
}

function numberHeader(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}

	const number = Number.parseInt(value, 10);
	return Number.isFinite(number) ? number : undefined;
}
