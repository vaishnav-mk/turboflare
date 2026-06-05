import { appConfig, type Env } from "../app/env";
import { errorResponse } from "../http/response";
import { readBearerToken, timingSafeEqual } from "./bearer-token";

export function requireInternalAdmin(request: Request, env: Env): Response | null {
	const token = appConfig(env).internalAdminToken;
	if (token === undefined) {
		return errorResponse(503, "unavailable", "Internal admin token is not configured");
	}

	const received = readBearerToken(request);
	if (received === null) {
		return errorResponse(401, "unauthorized", "Missing internal admin token", { "WWW-Authenticate": "Bearer" });
	}

	return timingSafeEqual(received, token) ? null : errorResponse(403, "forbidden", "Invalid internal admin token");
}
