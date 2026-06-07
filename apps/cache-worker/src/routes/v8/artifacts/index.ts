import { HttpMethod } from "@turboflare/protocol";

import type { Env } from "../../../app/env";
import type { AuthContext } from "../../../auth/types";
import { methodNotAllowed } from "../../../http/response";
import type { TenantContext } from "../../../tenancy/types";
import { getArtifact } from "./get";
import { headArtifact } from "./head";
import { putArtifact } from "./put";

export async function handleArtifact(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tenant: TenantContext,
  artifactId: string,
  authContext: AuthContext,
): Promise<Response> {
  if (request.method === HttpMethod.Put) {
    return putArtifact(request, env, ctx, tenant, artifactId, authContext);
  }

  if (request.method === HttpMethod.Get) {
    return getArtifact(env, ctx, tenant, artifactId);
  }

  if (request.method === HttpMethod.Head) {
    return headArtifact(env, tenant, artifactId);
  }

  return methodNotAllowed([HttpMethod.Get, HttpMethod.Head, HttpMethod.Put, HttpMethod.Options]);
}
