import { errorResponse } from "@turboflare/shared";

import type { Env } from "../app/env";
import type { AuthContext } from "../auth/types";
import type { TenantContext } from "../tenancy/types";

export async function enforceRateLimit(env: Env, authContext: AuthContext, tenant: TenantContext | null): Promise<Response | null> {
	if (env.RATE_LIMITER === undefined) {
		return null;
	}

	const key = tenant === null ? `token:${authContext.tokenId}` : `team:${tenant.key}:token:${authContext.tokenId}`;
	const { success } = await env.RATE_LIMITER.limit({ key });
	return success ? null : errorResponse(429, "rate_limited", "Rate limit exceeded");
}
