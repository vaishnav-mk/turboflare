import { errorResponse, methodNotAllowed } from "@turboflare/shared";

import type { Env } from "../../app/env";
import { requireAccess } from "../../auth/access";
import { handleInternalHealth } from "./health";
import { handleInternalTeam } from "./team";

export async function handleInternal(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith("/internal/")) {
		return null;
	}

	const accessError = requireAccess(request, env);
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

	if (url.pathname === "/internal/health") {
		return methodNotAllowed(["GET"]);
	}

	return errorResponse(404, "not_found", "Not found");
}
