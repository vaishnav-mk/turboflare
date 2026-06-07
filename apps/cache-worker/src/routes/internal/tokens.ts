import { HttpMethod, RouteAction, RoutePath } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { ErrorCode, errorResponse, jsonResponse, methodNotAllowed } from "../../http/response";
import { readBoundedJson } from "../../shared/json";
import { createToken, listTokens, revokeToken } from "../../storage/tokens";

const TOKEN_ROUTE = new RegExp(`^${RoutePath.InternalTokens}(?:/([^/]+)/${RouteAction.Revoke})?$`);
const TOKEN_DB_MISSING = "Token database is not configured";

export async function handleInternalTokens(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(TOKEN_ROUTE);
  if (match === null) {
    return null;
  }

  const tokenId = match[1] === undefined ? null : decodeURIComponent(match[1]);
  if (tokenId !== null) {
    if (request.method !== HttpMethod.Post) {
      return methodNotAllowed([HttpMethod.Post]);
    }

    const result = await revokeToken(env, tokenId);
    if (result === null) {
      return errorResponse(503, ErrorCode.Unavailable, TOKEN_DB_MISSING);
    }
    if ("error" in result) {
      return errorResponse(404, ErrorCode.NotFound, "Token not found or already revoked");
    }
    return jsonResponse(result);
  }

  if (request.method === HttpMethod.Get) {
    const tokens = await listTokens(env);
    if (tokens === null) {
      return errorResponse(503, ErrorCode.Unavailable, TOKEN_DB_MISSING);
    }

    return jsonResponse({ tokens });
  }

  if (request.method === HttpMethod.Post) {
    const body = await requestJson(request);
    if (body instanceof Response) {
      return body;
    }

    const created = await createToken(env, body);
    if (created === null) {
      return errorResponse(503, ErrorCode.Unavailable, TOKEN_DB_MISSING);
    }

    if ("error" in created) {
      if (created.error === "already_exists") {
        return errorResponse(
          409,
          ErrorCode.AlreadyExists,
          "Token id or token value already exists",
        );
      }
      return errorResponse(400, ErrorCode.BadRequest, created.error);
    }

    return jsonResponse({ token: created.token }, { status: 201 });
  }

  return methodNotAllowed([HttpMethod.Get, HttpMethod.Post]);
}

async function requestJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = await readBoundedJson(request, 16 * 1024);
    if (body.tooLarge) {
      return errorResponse(413, ErrorCode.PayloadTooLarge, "Token request body is too large");
    }
    return body.value !== null && typeof body.value === "object" && !Array.isArray(body.value)
      ? (body.value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
