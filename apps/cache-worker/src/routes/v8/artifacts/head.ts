import { HttpMethod } from "@turboflare/protocol";

import type { Env } from "../../../app/env";
import { recordMetric } from "../../../observability/metrics";
import { MetricEvent } from "../../../observability/types";
import { artifactStoreUnavailable } from "../../../storage/artifact-availability";
import { headArtifactObject } from "../../../storage/artifact-head";
import { artifactKey, fallbackArtifactKey } from "../../../storage/keys";
import { artifactResponseHeaders } from "../../../storage/metadata";
import type { TenantContext } from "../../../tenancy/types";

export async function headArtifact(
  env: Env,
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

  const storeError = artifactStoreUnavailable(env);
  if (storeError !== null) {
    return storeError;
  }

  let object = await headArtifactObject(env, key);
  if (object === null && fallbackKey !== null) {
    object = await headArtifactObject(env, fallbackKey);
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
