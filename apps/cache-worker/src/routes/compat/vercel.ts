import type { Env } from "../../app/env";
import { ALL_TEAMS } from "../../auth/constants";
import { authenticateBearer, hasScope } from "../../auth/bearer";
import { AuthScope, type AuthContext } from "../../auth/types";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../http/response";

interface CompatTeam {
	created: string;
	createdAt: number;
	id: string;
	membership: { role: "OWNER" };
	name: string;
	slug: string;
}

const DEFAULT_TEAM = "team_default";
const TEAMS_PATH = "/v2/teams";
const TEAM_ROUTE = /^\/v2\/teams\/([^/]+)$/;
const USER_PATH = "/v2/user";

export async function handleVercelCompatibility(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== USER_PATH && url.pathname !== TEAMS_PATH && !TEAM_ROUTE.test(url.pathname)) {
		return null;
	}

	if (request.method !== "GET") {
		return methodNotAllowed(["GET"]);
	}

	const authContext = await authenticateBearer(request, env);
	if (authContext === null) {
		return errorResponse(401, "unauthorized", "Missing or invalid bearer token", { "WWW-Authenticate": "Bearer" });
	}
	if (!hasScope(authContext, AuthScope.Read)) {
		return errorResponse(403, "forbidden", "Token does not have the required scope");
	}

	if (url.pathname === USER_PATH) {
		return jsonResponse({ user: compatUser(authContext) });
	}

	if (url.pathname === TEAMS_PATH) {
		return jsonResponse({ teams: compatTeams(authContext) });
	}

	const teamId = decodeURIComponent(url.pathname.match(TEAM_ROUTE)?.[1] ?? "");
	if (!canReturnTeam(authContext, teamId)) {
		return errorResponse(403, "forbidden", "Token cannot access this team");
	}

	return jsonResponse(compatTeam(teamId));
}

function compatUser(authContext: AuthContext): { email: string; id: string; name: string; username: string } {
	return {
		email: `${authContext.tokenId}@turboflare.local`,
		id: authContext.tokenId,
		name: "Turboflare User",
		username: authContext.tokenId,
	};
}

function compatTeams(authContext: AuthContext): readonly CompatTeam[] {
	const teams = authContext.allowedTeams.includes(ALL_TEAMS) ? [DEFAULT_TEAM] : authContext.allowedTeams;
	return teams.map(compatTeam);
}

function canReturnTeam(authContext: AuthContext, teamId: string): boolean {
	return authContext.allowedTeams.includes(ALL_TEAMS) || authContext.allowedTeams.includes(teamId);
}

function compatTeam(teamKey: string): CompatTeam {
	const slug = teamKey.startsWith("team_") ? teamKey.slice("team_".length) : teamKey;
	return {
		created: new Date(0).toISOString(),
		createdAt: 0,
		id: teamKey,
		membership: { role: "OWNER" },
		name: slug,
		slug,
	};
}
