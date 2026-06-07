import { HttpMethod, RoutePath } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { jsonResponse, methodNotAllowed } from "../../http/response";
import { cleanupExpiredArtifacts } from "../../storage/cleanup";

export async function handleInternalArtifacts(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== RoutePath.InternalArtifactsPurgeExpired) {
    return null;
  }

  if (request.method !== HttpMethod.Post) {
    return methodNotAllowed([HttpMethod.Post]);
  }

  const cleanup = await cleanupExpiredArtifacts(env);
  return jsonResponse(cleanup);
}
