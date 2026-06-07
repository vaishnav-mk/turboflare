import type { CacheStatusResponse } from "@turboflare/protocol";
import { HttpMethod } from "@turboflare/protocol";

import { appConfig, type Env } from "../../app/env";
import { jsonResponse, methodNotAllowed } from "../../http/response";
import { recordMetric } from "../../observability/metrics";
import { MetricEvent } from "../../observability/types";

export function handleStatus(request: Request, env: Env): Response {
  if (request.method !== HttpMethod.Get) {
    return methodNotAllowed([HttpMethod.Get, HttpMethod.Options]);
  }

  recordMetric(env, { event: MetricEvent.Status, method: request.method, status: 200 });
  const config = appConfig(env);
  const body = { status: config.cacheStatus } satisfies CacheStatusResponse;
  return jsonResponse(body);
}
