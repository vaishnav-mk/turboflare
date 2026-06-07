import { HttpMethod, RoutePath } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { ALL_TEAMS } from "../../auth/constants";
import { authenticateBearer, canAccessTeam } from "../../auth/bearer";
import { AuthScope, type AuthContext } from "../../auth/types";
import { ErrorCode, errorResponse, jsonResponse, methodNotAllowed } from "../../http/response";

interface CompatTeam {
  created: string;
  createdAt: number;
  id: string;
  membership: { role: "OWNER" };
  name: string;
  slug: string;
}

const DEFAULT_TEAM = "team_default";
const TEAM_ROUTE = new RegExp(`^${RoutePath.TurboIdentityTeams}/([^/]+)$`);

export async function handleTurboIdentityCompatibility(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== RoutePath.TurboIdentityUser &&
    url.pathname !== RoutePath.TurboIdentityTeams &&
    !TEAM_ROUTE.test(url.pathname)
  ) {
    return null;
  }

  if (request.method !== HttpMethod.Get) {
    return methodNotAllowed([HttpMethod.Get]);
  }

  const authContext = await authenticateBearer(request, env);
  if (authContext === null) {
    return errorResponse(401, ErrorCode.Unauthorized, "Missing or invalid bearer token", {
      "WWW-Authenticate": "Bearer",
    });
  }
  if (!authContext.scopes.includes(AuthScope.Read)) {
    return errorResponse(403, ErrorCode.Forbidden, "Token does not have the required scope");
  }

  if (url.pathname === RoutePath.TurboIdentityUser) {
    const user = compatUser(authContext);
    return jsonResponse({ user });
  }

  if (url.pathname === RoutePath.TurboIdentityTeams) {
    const teams = compatTeams(authContext);
    return jsonResponse({ teams });
  }

  const teamMatch = url.pathname.match(TEAM_ROUTE);
  const encodedTeamId = teamMatch?.[1] ?? "";
  const teamId = decodeURIComponent(encodedTeamId);
  if (!canAccessTeam(authContext, teamId)) {
    return errorResponse(403, ErrorCode.Forbidden, "Token cannot access this team");
  }

  const team = compatTeam(teamId);
  return jsonResponse(team);
}

function compatUser(authContext: AuthContext): {
  email: string;
  id: string;
  name: string;
  username: string;
} {
  return {
    email: `${authContext.tokenId}@turboflare.local`,
    id: authContext.tokenId,
    name: "Turboflare User",
    username: authContext.tokenId,
  };
}

function compatTeams(authContext: AuthContext): readonly CompatTeam[] {
  const teams = authContext.allowedTeams.includes(ALL_TEAMS)
    ? [DEFAULT_TEAM]
    : authContext.allowedTeams;
  return teams.map(compatTeam);
}

function compatTeam(teamKey: string): CompatTeam {
  const prefixLength = "team_".length;
  let slug = teamKey;
  if (teamKey.startsWith("team_")) {
    slug = teamKey.slice(prefixLength);
  }
  const created = new Date(0);
  return {
    created: created.toISOString(),
    createdAt: 0,
    id: teamKey,
    membership: { role: "OWNER" },
    name: slug,
    slug,
  };
}
