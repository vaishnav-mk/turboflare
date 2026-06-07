import type { Env } from "../app/env";
import type { AuthContext } from "../auth/types";
import { ErrorCode, errorResponse } from "../http/response";
import type { TenantContext } from "../tenancy/types";

export async function enforceRateLimit(
  env: Env,
  authContext: AuthContext,
  tenant: TenantContext | null,
): Promise<Response | null> {
  if (env.RATE_LIMITER === undefined) {
    return null;
  }

  const key =
    tenant === null
      ? `token:${authContext.tokenId}`
      : `team:${tenant.key}:token:${authContext.tokenId}`;
  let success: boolean;
  try {
    ({ success } = await env.RATE_LIMITER.limit({ key }));
  } catch (error) {
    console.error("rate limiter failed", error);
    return errorResponse(503, ErrorCode.Unavailable, "Rate limiter is unavailable");
  }
  return success ? null : errorResponse(429, ErrorCode.RateLimited, "Rate limit exceeded");
}
