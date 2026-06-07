import type { Env } from "../../app/env";
import { requireInternalAdmin } from "../../auth/internal";
import { errorResponse, methodNotAllowed } from "../../http/response";
import { handleInternalArtifacts } from "./artifacts";
import { handleInternalTeam } from "./team";
import { handleInternalTokens } from "./tokens";

export async function handleInternal(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith("/internal/")) {
		return null;
	}

	const adminError = requireInternalAdmin(request, env);
	if (adminError !== null) {
		return adminError;
	}

	if (url.pathname === "/internal/health") {
		return request.method === "GET" ? new Response(null, { status: 200 }) : methodNotAllowed(["GET"]);
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

	return errorResponse(404, "not_found", "Not found");
}
