import type { CacheStatusResponse } from "@turboflare/protocol";
import { HttpMethod } from "@turboflare/protocol";
import { jsonResponse, methodNotAllowed } from "@turboflare/shared";

import { appConfig, type Env } from "../../app/env";
import { recordMetric } from "../../observability/metrics";
import { MetricEvent } from "../../observability/types";

export function handleStatus(request: Request, env: Env, ctx: ExecutionContext): Response {
	if (request.method !== HttpMethod.Get) {
		return methodNotAllowed([HttpMethod.Get, HttpMethod.Options]);
	}

	recordMetric(env, ctx, { event: MetricEvent.Status, method: request.method, status: 200 });
	return jsonResponse({ status: appConfig(env).cacheStatus } satisfies CacheStatusResponse);
}
