import { appConfig, type Env } from "../app/env";
import { ErrorCode, errorResponse } from "../http/response";
import { sha256Hex } from "../shared/hash";
import { readBearerToken } from "./bearer-token";

export async function requireInternalAdmin(request: Request, env: Env): Promise<Response | null> {
  const token = appConfig(env).internalAdminToken;
  if (token === undefined) {
    return errorResponse(503, ErrorCode.Unavailable, "Internal admin token is not configured");
  }

  const received = readBearerToken(request);
  if (received === null) {
    return errorResponse(401, ErrorCode.Unauthorized, "Missing internal admin token", {
      "WWW-Authenticate": "Bearer",
    });
  }

  const receivedHash = await sha256Hex(received);
  const tokenHash = await sha256Hex(token);
  return receivedHash === tokenHash
    ? null
    : errorResponse(403, ErrorCode.Forbidden, "Invalid internal admin token");
}
