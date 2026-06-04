import { errorResponse } from "@turboflare/shared";

import { appConfig, type Env } from "../app/env";

export function requireAccess(request: Request, env: Env): Response | null {
	if (appConfig(env).internalAccessBypass) {
		return null;
	}

	const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
	if (assertion === null || assertion.length === 0) {
		return errorResponse(401, "unauthorized", "Missing Cloudflare Access assertion");
	}

	return errorResponse(403, "forbidden", "Cloudflare Access assertion verification is not configured");
}
