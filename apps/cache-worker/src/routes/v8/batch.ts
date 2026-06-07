import { type ArtifactLookupRequest, HttpMethod } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { ErrorCode, errorResponse, methodNotAllowed } from "../../http/response";
import { readBoundedJson } from "../../shared/json";
import { artifactStoreUnavailable } from "../../storage/artifact-availability";
import { MAX_TURBO_JSON_BODY_BYTES } from "../../storage/constants";
import { lookupArtifacts } from "../../storage/lookup";
import type { TenantContext } from "../../tenancy/types";

export async function handleArtifactLookup(
  request: Request,
  env: Env,
  tenant: TenantContext,
): Promise<Response> {
  if (request.method !== HttpMethod.Post) {
    return methodNotAllowed([HttpMethod.Post, HttpMethod.Options]);
  }

  const payload = await readLookupRequest(request);
  if (payload instanceof Response) {
    return payload;
  }

  const storeError = artifactStoreUnavailable(env);
  return storeError ?? lookupArtifacts(env, tenant, payload.hashes);
}

async function readLookupRequest(request: Request): Promise<ArtifactLookupRequest | Response> {
  try {
    const body = await readBoundedJson(request, MAX_TURBO_JSON_BODY_BYTES);
    if (body.tooLarge) {
      return errorResponse(
        413,
        ErrorCode.PayloadTooLarge,
        "Artifact lookup request body is too large",
      );
    }
    if (!isLookupRequest(body.value)) {
      return errorResponse(
        400,
        ErrorCode.BadRequest,
        "Artifact lookup request must be { hashes: string[] }",
      );
    }

    return body.value;
  } catch {
    return errorResponse(400, ErrorCode.BadRequest, "Artifact lookup request body must be JSON");
  }
}

const MAX_HASH_LENGTH = 256;

function isLookupRequest(value: unknown): value is ArtifactLookupRequest {
  if (typeof value !== "object" || value === null || !("hashes" in value)) {
    return false;
  }

  const hashes = (value as { hashes: unknown }).hashes;
  return (
    Array.isArray(hashes) &&
    hashes.every(
      (hash) => typeof hash === "string" && hash.length > 0 && hash.length <= MAX_HASH_LENGTH,
    )
  );
}
