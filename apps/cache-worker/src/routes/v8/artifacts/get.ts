import { HttpMethod } from "@turboflare/protocol";

import { appConfig, type Env } from "../../../app/env";
import { numberHeader } from "../../../http/headers";
import { recordMetric } from "../../../observability/metrics";
import { MetricEvent } from "../../../observability/types";
import { artifactStoreUnavailable, getArtifactObject } from "../../../storage/artifact/store";
import { artifactCache, cacheableResponse, cacheRequest } from "../../../storage/cache-api";
import { artifactKeySet } from "../../../storage/keys";
import { artifactResponseHeaders } from "../../../storage/metadata";
import type { TenantContext } from "../../../tenancy/types";

export async function getArtifact(
  env: Env,
  ctx: ExecutionContext,
  tenant: TenantContext,
  artifactId: string,
): Promise<Response> {
  const keys = artifactKeySet(tenant, artifactId);
  if (keys instanceof Response) {
    return keys;
  }

  const config = appConfig(env);
  if (config.cacheApiReads) {
    const cache = artifactCache();
    const cachedRequest = cacheRequest(keys.key);
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

  let object = await getArtifactObject(env, keys.key);
  if (object === null && keys.fallbackKey !== null) {
    object = await getArtifactObject(env, keys.fallbackKey);
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
    const request = cacheRequest(keys.key);
    const clonedResponse = response.clone();
    const cachedResponse = cacheableResponse(clonedResponse, keys.key);
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
