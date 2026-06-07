import { HttpMethod } from "@turboflare/protocol";

import { appConfig, type Env } from "../../../app/env";
import { numberHeader } from "../../../http/headers";
import { recordMetric } from "../../../observability/metrics";
import { MetricEvent } from "../../../observability/types";
import { artifactStoreUnavailable } from "../../../storage/artifact/availability";
import { getArtifactObject } from "../../../storage/artifact/get";
import { artifactCache, cacheableResponse, cacheRequest } from "../../../storage/cache-api";
import { artifactKey, fallbackArtifactKey } from "../../../storage/keys";
import { artifactResponseHeaders } from "../../../storage/metadata";
import type { TenantContext } from "../../../tenancy/types";

export async function getArtifact(
  env: Env,
  ctx: ExecutionContext,
  tenant: TenantContext,
  artifactId: string,
): Promise<Response> {
  const key = artifactKey(tenant, artifactId);
  if (key instanceof Response) {
    return key;
  }
  const fallbackKey = fallbackArtifactKey(tenant, artifactId);
  if (fallbackKey instanceof Response) {
    return fallbackKey;
  }

  const config = appConfig(env);
  if (config.cacheApiReads) {
    const cache = artifactCache();
    const cachedRequest = cacheRequest(key);
    const cached = await cache.match(cachedRequest);
    if (cached !== undefined) {
      const cachedContentLength = cached.headers.get("Content-Length");
      const cachedBytes = numberHeader(cachedContentLength);
      recordMetric(env, {
        artifactId,
        bytes: cachedBytes,
        event: MetricEvent.GetHit,
        method: HttpMethod.Get,
        status: 200,
        tenant: tenant.key,
      });
      return cached;
    }
  }

  const storeError = artifactStoreUnavailable(env);
  if (storeError !== null) {
    return storeError;
  }

  let object = await getArtifactObject(env, key);
  if (object === null && fallbackKey !== null) {
    object = await getArtifactObject(env, fallbackKey);
  }
  if (object === null) {
    recordMetric(env, {
      artifactId,
      event: MetricEvent.GetMiss,
      method: HttpMethod.Get,
      status: 404,
      tenant: tenant.key,
    });
    return new Response(null, { status: 404 });
  }

  const response = new Response(object.body, {
    headers: artifactResponseHeaders(object),
  });

  if (config.cacheApiReads && object.size <= config.cacheApiMaxBytes) {
    const cache = artifactCache();
    const request = cacheRequest(key);
    const clonedResponse = response.clone();
    const cachedResponse = cacheableResponse(clonedResponse, key);
    const cachePut = cache.put(request, cachedResponse);
    ctx.waitUntil(cachePut);
  }

  recordMetric(env, {
    artifactId,
    bytes: object.size,
    event: MetricEvent.GetHit,
    method: HttpMethod.Get,
    status: 200,
    tenant: tenant.key,
  });
  return response;
}
