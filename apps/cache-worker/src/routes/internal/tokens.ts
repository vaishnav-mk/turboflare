import { errorResponse, jsonResponse, methodNotAllowed } from "@turboflare/shared";

import type { Env } from "../../app/env";
import { createToken, listTokens, revokeToken } from "../../storage/tokens";

const TOKEN_ROUTE = /^\/internal\/tokens(?:\/([^/]+)\/revoke)?$/;

export async function handleInternalTokens(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	const match = url.pathname.match(TOKEN_ROUTE);
	if (match === null) {
		return null;
	}

	const tokenId = match[1] === undefined ? null : decodeURIComponent(match[1]);
	if (tokenId !== null) {
		if (request.method !== "POST") {
			return methodNotAllowed(["POST"]);
		}

		const revoked = await revokeToken(env, tokenId);
		return revoked === null ? tokenDbMissing() : jsonResponse({ revoked });
	}

	if (request.method === "GET") {
		const tokens = await listTokens(env);
		return tokens === null ? tokenDbMissing() : jsonResponse({ tokens });
	}

	if (request.method === "POST") {
		const created = await createToken(env, await requestJson(request));
		if (created === null) {
			return tokenDbMissing();
		}

		if ("error" in created) {
			return errorResponse(400, "bad_request", created.error);
		}

		return jsonResponse({ token: created.token }, { status: 201 });
	}

	return methodNotAllowed(["GET", "POST"]);
}

async function requestJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = (await request.json()) as unknown;
		return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function tokenDbMissing(): Response {
	return errorResponse(503, "unavailable", "Token database is not configured");
}
