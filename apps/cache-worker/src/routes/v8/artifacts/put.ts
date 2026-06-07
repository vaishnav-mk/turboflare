import { ArtifactHeader } from "@turboflare/protocol";

import { ArtifactStore, SignaturePolicy, appConfig, type Env } from "../../../app/env";
import type { AuthContext } from "../../../auth/types";
import { ErrorCode, errorResponse, jsonResponse } from "../../../http/response";
import { recordMetric } from "../../../observability/metrics";
import { MetricEvent } from "../../../observability/types";
import { readBoundedBytes } from "../../../shared/json";
import { indexArtifact } from "../../../storage/artifact/index";
import {
  artifactStoreUnavailable,
  artifactUploadLimit,
  putArtifactObject,
} from "../../../storage/artifact/store";
import { deleteCachedArtifacts } from "../../../storage/cache-api";
import { OCTET_STREAM } from "../../../storage/constants";
import { artifactKey } from "../../../storage/keys";
import { artifactCustomMetadata } from "../../../storage/metadata";
import type { TenantContext } from "../../../tenancy/types";

export async function putArtifact(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tenant: TenantContext,
  artifactId: string,
  authContext: AuthContext,
): Promise<Response> {
  const config = appConfig(env);
  if (config.readOnly || tenant.readOnly) {
    return errorResponse(403, ErrorCode.Forbidden, "Remote cache is running in read-only mode");
  }

  const signatureError = requireSignature(request, config.signaturePolicy);
  if (signatureError !== null) {
    return signatureError;
  }
  recordSignatureMetric(request, env, tenant, artifactId, authContext, config.signaturePolicy);

  const rawContentLength = request.headers.get("Content-Length");
  const contentLength = contentLengthHeader(rawContentLength);
  if (contentLength instanceof Response) {
    return contentLength;
  }

  const uploadLimit = artifactUploadLimit(env);
  if (uploadLimit > 0 && contentLength !== undefined && contentLength > uploadLimit) {
    return artifactTooLargeResponse(config.artifactStore);
  }

  const storeError = artifactStoreUnavailable(env);
  if (storeError !== null) {
    return storeError;
  }

  const contentType = request.headers.get("Content-Type");
  if (contentType !== null && contentType.toLowerCase() !== OCTET_STREAM) {
    return errorResponse(400, ErrorCode.BadRequest, `Artifact upload must use ${OCTET_STREAM}`);
  }

  let body = request.body;
  if (body === null) {
    return errorResponse(400, ErrorCode.BadRequest, "Artifact upload requires a request body");
  }
  if (uploadLimit > 0 && contentLength === undefined) {
    const buffered = await readBoundedBytes(body, uploadLimit);
    if (buffered.tooLarge) {
      return artifactTooLargeResponse(config.artifactStore);
    }
    const uploadBuffer = arrayBuffer(buffered.bytes);
    body = new Response(uploadBuffer).body;
    if (body === null) {
      return errorResponse(400, ErrorCode.BadRequest, "Artifact upload requires a request body");
    }
  }

  const key = artifactKey(tenant, artifactId);
  if (key instanceof Response) {
    return key;
  }

  const customMetadata = artifactCustomMetadata(
    request,
    new URL(request.url),
    tenant,
    artifactId,
    authContext,
  );
  if (customMetadata instanceof Response) {
    return customMetadata;
  }

  const object = await putArtifactObject(env, key, body, customMetadata);
  await deleteCachedArtifacts([key]);
  ctx.waitUntil(
    indexArtifact(env, { artifactId, authContext, customMetadata, key, object, tenant }).catch(
      () => undefined,
    ),
  );
  recordMetric(env, {
    artifactId,
    event: MetricEvent.Put,
    method: request.method,
    status: 200,
    tenant: tenant.key,
    tokenId: authContext.tokenId,
  });
  return jsonResponse({ urls: [] });
}

function contentLengthHeader(value: string | null): number | Response | undefined {
  if (value === null) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return errorResponse(
      400,
      ErrorCode.BadRequest,
      "Content-Length must be a non-negative integer",
    );
  }

  return Number(value);
}

function artifactTooLargeResponse(store: ArtifactStore): Response {
  const message =
    store === ArtifactStore.Kv
      ? "Artifact upload exceeds configured KV size limit"
      : "Artifact upload exceeds configured size limit";
  return errorResponse(413, ErrorCode.ArtifactTooLarge, message);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function requireSignature(request: Request, policy: SignaturePolicy): Response | null {
  if (policy !== SignaturePolicy.Require) {
    return null;
  }

  if (hasSignature(request)) {
    return null;
  }

  return errorResponse(400, ErrorCode.SignatureRequired, "Signed artifact metadata is required");
}

function recordSignatureMetric(
  request: Request,
  env: Env,
  tenant: TenantContext,
  artifactId: string,
  authContext: AuthContext,
  policy: SignaturePolicy,
): void {
  if (policy === SignaturePolicy.Monitor && !hasSignature(request)) {
    recordMetric(env, {
      artifactId,
      event: MetricEvent.SignatureMissing,
      method: request.method,
      status: 200,
      tenant: tenant.key,
      tokenId: authContext.tokenId,
    });
  }
}

function hasSignature(request: Request): boolean {
  const signature = request.headers.get(ArtifactHeader.Tag);
  const trimmedSignature = signature?.trim();
  return (trimmedSignature?.length ?? 0) > 0;
}
