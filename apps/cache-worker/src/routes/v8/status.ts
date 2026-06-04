import type { CacheStatusResponse } from "@turboflare/protocol";
import { HttpMethod } from "@turboflare/protocol";
import { jsonResponse, methodNotAllowed } from "@turboflare/shared";

import { appConfig, type Env } from "../../app/env";

export function handleStatus(request: Request, env: Env): Response {
	if (request.method !== HttpMethod.Get) {
		return methodNotAllowed([HttpMethod.Get, HttpMethod.Options]);
	}

	return jsonResponse({ status: appConfig(env).cacheStatus } satisfies CacheStatusResponse);
}
