import { HttpMethod, RouteAction, RoutePath } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { jsonResponse, methodNotAllowed } from "../../http/response";
import { purgeTeam, teamStats } from "../../storage/admin";

const TEAM_ROUTE = new RegExp(
  `^${RoutePath.InternalTeams}/([^/]+)/(${RouteAction.Stats}|${RouteAction.PurgeAll})$`,
);

export async function handleInternalTeam(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(TEAM_ROUTE);
  if (match === null) {
    return null;
  }

  const team = decodeURIComponent(match[1]);
  const action = match[2];

  if (action === RouteAction.Stats) {
    if (request.method !== HttpMethod.Get) {
      return methodNotAllowed([HttpMethod.Get]);
    }

    const stats = await teamStats(env, team);
    return jsonResponse(stats);
  }

  if (request.method !== HttpMethod.Post) {
    return methodNotAllowed([HttpMethod.Post]);
  }

  const purge = await purgeTeam(env, team);
  return jsonResponse(purge);
}
