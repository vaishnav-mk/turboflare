import type { ArtifactLookupResponse } from "@turboflare/protocol";

import type { Env } from "../app/env";
import { ErrorCode, errorResponse, jsonResponse } from "../http/response";
import { mapWithConcurrency } from "../shared/concurrency";
import type { TenantContext } from "../tenancy/types";
import { headArtifactObject } from "./artifact-head";
import { BATCH_HEAD_CONCURRENCY, MAX_BATCH_HASHES } from "./constants";
import { artifactKey, fallbackArtifactKey } from "./keys";
import { lookupHit } from "./metadata";

export async function lookupArtifacts(
  env: Env,
  tenant: TenantContext,
  artifactIds: readonly string[],
): Promise<Response> {
  if (artifactIds.length > MAX_BATCH_HASHES) {
    return errorResponse(
      400,
      ErrorCode.BadRequest,
      `Artifact lookup supports at most ${MAX_BATCH_HASHES} hashes`,
    );
  }

  const entries = await mapWithConcurrency(
    artifactIds,
    BATCH_HEAD_CONCURRENCY,
    async (artifactId) => {
      const key = artifactKey(tenant, artifactId);
      if (key instanceof Response) {
        return [artifactId, null] as const;
      }
      const fallbackKey = fallbackArtifactKey(tenant, artifactId);
      if (fallbackKey instanceof Response) {
        return [artifactId, null] as const;
      }

      let object = await headArtifactObject(env, key);
      if (object === null && fallbackKey !== null) {
        object = await headArtifactObject(env, fallbackKey);
      }
      return [artifactId, object === null ? null : lookupHit(object)] as const;
    },
  );

  const body = Object.fromEntries(entries) as ArtifactLookupResponse;
  return jsonResponse(body);
}
