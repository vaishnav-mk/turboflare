import { HttpMethod } from "@turboflare/protocol";

import type { Env } from "../../../app/env";
import { recordMetric } from "../../../observability/metrics";
import { MetricEvent } from "../../../observability/types";
import { artifactStoreUnavailable, headArtifactObject } from "../../../storage/artifact/store";
import { artifactKeySet } from "../../../storage/keys";
import { artifactResponseHeaders } from "../../../storage/metadata";
import type { TenantContext } from "../../../tenancy/types";

export async function headArtifact(
  env: Env,
  tenant: TenantContext,
  artifactId: string,
): Promise<Response> {
  const keys = artifactKeySet(tenant, artifactId);
  if (keys instanceof Response) {
    return keys;
  }

  const storeError = artifactStoreUnavailable(env);
  if (storeError !== null) {
    return storeError;
  }

  let object = await headArtifactObject(env, keys.key);
  if (object === null && keys.fallbackKey !== null) {
    object = await headArtifactObject(env, keys.fallbackKey);
  }
  if (object === null) {
    recordMetric(env, {
      artifactId,
      event: MetricEvent.HeadMiss,
      method: HttpMethod.Head,
      status: 404,
      tenant: tenant.key,
    });
    return new Response(null, { status: 404 });
  }

  recordMetric(env, {
    artifactId,
    bytes: object.size,
    event: MetricEvent.HeadHit,
    method: HttpMethod.Head,
    status: 200,
    tenant: tenant.key,
  });
  const headers = artifactResponseHeaders(object);
  return new Response(null, { headers });
}
