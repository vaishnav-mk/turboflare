import { ARTIFACT_EVENTS_PATH, ARTIFACT_STATUS_PATH, ARTIFACTS_PATH, HttpMethod, TURBO_API_PREFIX } from "@turboflare/protocol";
import { errorResponse } from "@turboflare/shared";

import type { Env } from "./env";
import { authenticateBearer, canAccessTenant, hasScope } from "../auth/bearer";
import { AuthScope } from "../auth/types";
import { recordMetric } from "../observability/metrics";
import { MetricEvent } from "../observability/types";
import { enforceRateLimit } from "../rate-limit/enforce";
import { handleVercelCompatibility } from "../routes/compat/vercel";
import { handleHealth } from "../routes/internal/health";
import { handleInternal } from "../routes/internal/router";
import { handleArtifact } from "../routes/v8/artifacts";
import { handleArtifactLookup } from "../routes/v8/batch";
import { handleEvents } from "../routes/v8/events";
import { preflightResponse } from "../routes/v8/preflight";
import { withProtocolHeaders } from "../routes/v8/response";
import { handleStatus } from "../routes/v8/status";
import { resolveTenant } from "../tenancy/resolve";

const ARTIFACT_ITEM_PREFIX = `${ARTIFACTS_PATH}/`;

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === HttpMethod.Get && url.pathname === "/") {
		return new Response("Turboflare remote cache\n", {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
			},
		});
	}

	const health = handleHealth(request);
	if (health !== null) {
		return health;
	}

	const internal = await handleInternal(request, env);
	if (internal !== null) {
		return internal;
	}

	const compat = await handleVercelCompatibility(request, env);
	if (compat !== null) {
		return compat;
	}

	if (!url.pathname.startsWith(`${TURBO_API_PREFIX}/`)) {
		return errorResponse(404, "not_found", "Not found");
	}

	if (request.method === HttpMethod.Options) {
		recordMetric(env, ctx, { event: MetricEvent.Preflight, method: request.method, status: 204 });
		return preflightResponse();
	}

	const requiredScope = request.method === HttpMethod.Put ? AuthScope.Write : AuthScope.Read;
	const authContext = await authenticateBearer(request, env);
	if (authContext === null) {
		return withProtocolHeaders(
			errorResponse(401, "unauthorized", "Missing or invalid bearer token", {
				"WWW-Authenticate": "Bearer",
			})
		);
	}
	if (!hasScope(authContext, requiredScope)) {
		return withProtocolHeaders(errorResponse(403, "forbidden", "Token does not have the required scope"));
	}

	if (url.pathname === ARTIFACT_STATUS_PATH) {
		const rateLimitError = await enforceRateLimit(env, authContext, null);
		if (rateLimitError !== null) {
			return withProtocolHeaders(rateLimitError);
		}

		return withProtocolHeaders(handleStatus(request, env, ctx));
	}

	const tenant = resolveTenant(url);
	if (!canAccessTenant(authContext, tenant)) {
		return withProtocolHeaders(errorResponse(403, "forbidden", "Token cannot access this team"));
	}

	const rateLimitError = await enforceRateLimit(env, authContext, tenant);
	if (rateLimitError !== null) {
		return withProtocolHeaders(rateLimitError);
	}

	if (url.pathname === ARTIFACT_EVENTS_PATH) {
		return withProtocolHeaders(await handleEvents(request, env, ctx));
	}

	if (url.pathname === ARTIFACTS_PATH || url.pathname === `${ARTIFACTS_PATH}/`) {
		return withProtocolHeaders(await handleArtifactLookup(request, env, tenant));
	}

	const artifactId = parseArtifactId(url.pathname);
	if (artifactId === null) {
		return withProtocolHeaders(errorResponse(404, "not_found", "Not found"));
	}

	return withProtocolHeaders(await handleArtifact(request, env, ctx, tenant, artifactId, authContext));
}

function parseArtifactId(pathname: string): string | null {
	if (!pathname.startsWith(ARTIFACT_ITEM_PREFIX)) {
		return null;
	}

	const encodedArtifactId = pathname.slice(ARTIFACT_ITEM_PREFIX.length);
	if (encodedArtifactId.length === 0 || encodedArtifactId.includes("/")) {
		return null;
	}

	try {
		const artifactId = decodeURIComponent(encodedArtifactId);
		return artifactId.length > 0 ? artifactId : null;
	} catch {
		return null;
	}
}
