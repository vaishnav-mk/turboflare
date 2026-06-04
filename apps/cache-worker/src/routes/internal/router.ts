import { errorResponse, methodNotAllowed } from "@turboflare/shared";

import type { Env } from "../../app/env";
import { requireAccess } from "../../auth/access";
import { handleInternalArtifacts } from "./artifacts";
import { handleInternalHealth } from "./health";
import { handleInternalTeam } from "./team";
import { handleInternalTokens } from "./tokens";

export async function handleInternal(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith("/internal/")) {
		return null;
	}

	const accessError = await requireAccess(request, env);
	if (accessError !== null) {
		return accessError;
	}

	const health = handleInternalHealth(request);
	if (health !== null) {
		return health;
	}

	const team = await handleInternalTeam(request, env);
	if (team !== null) {
		return team;
	}

	const artifacts = await handleInternalArtifacts(request, env);
	if (artifacts !== null) {
		return artifacts;
	}

	const tokens = await handleInternalTokens(request, env);
	if (tokens !== null) {
		return tokens;
	}

	if (url.pathname === "/internal/health") {
		return methodNotAllowed(["GET"]);
	}

	return errorResponse(404, "not_found", "Not found");
}
