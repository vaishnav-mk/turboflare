import { errorResponse, jsonResponse, methodNotAllowed } from "@turboflare/shared";

import type { Env } from "../../app/env";
import { purgeTeam, teamStats } from "../../storage/admin";

const TEAM_ROUTE = /^\/internal\/teams\/([^/]+)\/(stats|purge-all)$/;

export async function handleInternalTeam(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	const match = url.pathname.match(TEAM_ROUTE);
	if (match === null) {
		return null;
	}

	const team = decodeURIComponent(match[1]);
	const action = match[2];

	if (action === "stats") {
		if (request.method !== "GET") {
			return methodNotAllowed(["GET"]);
		}

		return jsonResponse(await teamStats(env, team));
	}

	if (action === "purge-all") {
		if (request.method !== "POST") {
			return methodNotAllowed(["POST"]);
		}

		return jsonResponse(await purgeTeam(env, team));
	}

	return errorResponse(404, "not_found", "Not found");
}
