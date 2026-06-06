import { ArtifactHeader, HttpMethod } from "@turboflare/protocol";

import { SignaturePolicy, appConfig, type Env } from "../../app/env";
import type { AuthContext } from "../../auth/types";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../http/response";
import { recordMetric } from "../../observability/metrics";
import { MetricEvent } from "../../observability/types";
import { artifactStoreUnavailable, getArtifactObject, headArtifactObject, kvUploadLimitError, putArtifactObject } from "../../storage/artifacts";
import { artifactCache, cacheableResponse, cacheRequest } from "../../storage/cache-api";
import { indexArtifact } from "../../storage/artifact-index";
import { artifactKey, fallbackArtifactKey } from "../../storage/keys";
import { artifactCustomMetadata, artifactResponseHeaders } from "../../storage/metadata";
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
	const config = appConfig(env);
	if (config.readOnly || tenant.readOnly) {
		return errorResponse(403, "forbidden", "Remote cache is running in read-only mode");
	}

	const signatureError = requireSignature(request, config.signaturePolicy);
	if (signatureError !== null) {
		return signatureError;
	}
	recordSignatureMetric(request, env, ctx, tenant, artifactId, authContext, config.signaturePolicy);

	const contentLength = numberHeader(request.headers.get("Content-Length"));
	if (config.maxArtifactBytes > 0 && contentLength !== undefined && contentLength > config.maxArtifactBytes) {
		return errorResponse(413, "artifact_too_large", "Artifact upload exceeds configured size limit");
	}

	const storeError = artifactStoreUnavailable(env) ?? kvUploadLimitError(env, contentLength);
	if (storeError !== null) {
		return storeError;
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

	const object = await putArtifactObject(env, key, request.body, customMetadata);
	ctx.waitUntil(indexArtifact(env, { artifactId, authContext, customMetadata, key, object, tenant }).catch(() => undefined));
	recordMetric(env, ctx, { artifactId, event: MetricEvent.Put, method: request.method, status: 200, tenant: tenant.key, tokenId: authContext.tokenId });
	return jsonResponse({ urls: [] });
}

async function getArtifact(env: Env, ctx: ExecutionContext, tenant: TenantContext, artifactId: string): Promise<Response> {
	const key = artifactKey(tenant, artifactId);
	if (key instanceof Response) {
		return key;
	}
	const fallbackKey = fallbackArtifactKey(tenant, artifactId);
	if (fallbackKey instanceof Response) {
		return fallbackKey;
	}

	const config = appConfig(env);
	if (config.cacheApiReads) {
		const cached = await artifactCache().match(cacheRequest(key));
		if (cached !== undefined) {
			recordMetric(env, ctx, { artifactId, bytes: numberHeader(cached.headers.get("Content-Length")), event: MetricEvent.GetHit, method: HttpMethod.Get, status: 200, tenant: tenant.key });
			return cached;
		}
	}

	const storeError = artifactStoreUnavailable(env);
	if (storeError !== null) {
		return storeError;
	}

	const object = (await getArtifactObject(env, key)) ?? (fallbackKey === null ? null : await getArtifactObject(env, fallbackKey));
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
	const fallbackKey = fallbackArtifactKey(tenant, artifactId);
	if (fallbackKey instanceof Response) {
		return fallbackKey;
	}

	const storeError = artifactStoreUnavailable(env);
	if (storeError !== null) {
		return storeError;
	}

	const object = (await headArtifactObject(env, key)) ?? (fallbackKey === null ? null : await headArtifactObject(env, fallbackKey));
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

function requireSignature(request: Request, policy: SignaturePolicy): Response | null {
	if (policy !== SignaturePolicy.Require) {
		return null;
	}

	return hasSignature(request) ? null : errorResponse(400, "signature_required", "Signed artifact metadata is required");
}

function recordSignatureMetric(request: Request, env: Env, ctx: ExecutionContext, tenant: TenantContext, artifactId: string, authContext: AuthContext, policy: SignaturePolicy): void {
	if (policy === SignaturePolicy.Monitor && !hasSignature(request)) {
		recordMetric(env, ctx, { artifactId, event: MetricEvent.SignatureMissing, method: request.method, status: 200, tenant: tenant.key, tokenId: authContext.tokenId });
	}
}

function hasSignature(request: Request): boolean {
	return (request.headers.get(ArtifactHeader.Sha)?.trim().length ?? 0) > 0;
}
