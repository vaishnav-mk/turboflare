import {
  ARTIFACT_EVENTS_PATH,
  ARTIFACT_STATUS_PATH,
  ARTIFACTS_PATH,
  HttpMethod,
  TURBO_API_PREFIX,
} from "@turboflare/protocol";

import type { Env } from "./env";
import { authenticateBearer, canAccessTenant, hasScope } from "../auth/bearer";
import { AuthScope, type AuthContext } from "../auth/types";
import { ErrorCode, errorResponse } from "../http/response";
import { recordMetric } from "../observability/metrics";
import { MetricEvent } from "../observability/types";
import { enforceRateLimit } from "../rate-limit/enforce";
import { handleTurboIdentityCompatibility } from "../routes/compat/turbo-identity";
import { handleInternal } from "../routes/internal/router";
import { handleArtifact } from "../routes/v8/artifacts";
import { handleArtifactLookup } from "../routes/v8/batch";
import { handleEvents } from "../routes/v8/events";
import { preflightResponse } from "../routes/v8/preflight";
import { withProtocolHeaders } from "../routes/v8/response";
import { handleStatus } from "../routes/v8/status";
import { resolveTenant } from "../tenancy/resolve";
import type { TenantContext } from "../tenancy/types";

const ARTIFACT_ITEM_PREFIX = `${ARTIFACTS_PATH}/`;

interface RequestState {
  ctx: ExecutionContext;
  env: Env;
  request: Request;
  url: URL;
}

interface AuthenticatedState extends RequestState {
  authContext: AuthContext;
}

interface TenantState extends AuthenticatedState {
  tenant: TenantContext;
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const state = { ctx, env, request, url: new URL(request.url) } satisfies RequestState;

  const publicResponse = handlePublicRoute(state);
  if (publicResponse !== null) {
    return publicResponse;
  }

  const internal = await handleInternal(request, env);
  if (internal !== null) {
    return internal;
  }

  const compat = await handleTurboIdentityCompatibility(request, env);
  if (compat !== null) {
    return compat;
  }

  if (!isTurboPath(state.url.pathname)) {
    return errorResponse(404, ErrorCode.NotFound, "Not found");
  }

  return handleTurboRoute(state);
}

function handlePublicRoute({ request, url }: RequestState): Response | null {
  if (request.method === HttpMethod.Get && url.pathname === "/") {
    return new Response("Turboflare remote cache\n", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  if (request.method === HttpMethod.Get && url.pathname === "/management/health") {
    return new Response(null, { status: 200 });
  }

  return null;
}

async function handleTurboRoute(state: RequestState): Promise<Response> {
  const preflight = handlePreflight(state);
  if (preflight !== null) {
    return preflight;
  }

  const authenticated = await authenticateTurbo(state);
  if (authenticated instanceof Response) {
    return authenticated;
  }

  if (state.url.pathname === ARTIFACT_STATUS_PATH) {
    return handleStatusRoute(authenticated);
  }

  const tenantState = authorizeTenant(authenticated);
  if (tenantState instanceof Response) {
    return tenantState;
  }

  const rateLimitError = await enforceRateLimit(
    state.env,
    authenticated.authContext,
    tenantState.tenant,
  );
  if (rateLimitError !== null) {
    return protocolResponse(rateLimitError);
  }

  return handleTenantRoute(tenantState);
}

function handlePreflight({ ctx, env, request }: RequestState): Response | null {
  if (request.method !== HttpMethod.Options) {
    return null;
  }

  recordMetric(env, ctx, { event: MetricEvent.Preflight, method: request.method, status: 204 });
  return preflightResponse();
}

async function authenticateTurbo(state: RequestState): Promise<AuthenticatedState | Response> {
  const { env, request } = state;
  const authContext = await authenticateBearer(request, env);
  if (authContext === null) {
    return protocolResponse(
      errorResponse(401, ErrorCode.Unauthorized, "Missing or invalid bearer token", {
        "WWW-Authenticate": "Bearer",
      }),
    );
  }

  const requiredScope = request.method === HttpMethod.Put ? AuthScope.Write : AuthScope.Read;
  if (!hasScope(authContext, requiredScope)) {
    const response = errorResponse(
      403,
      ErrorCode.Forbidden,
      "Token does not have the required scope",
    );
    return protocolResponse(response);
  }

  return { ...state, authContext };
}

async function handleStatusRoute({
  authContext,
  ctx,
  env,
  request,
}: AuthenticatedState): Promise<Response> {
  const rateLimitError = await enforceRateLimit(env, authContext, null);
  if (rateLimitError !== null) {
    return protocolResponse(rateLimitError);
  }

  const response = handleStatus(request, env, ctx);
  return protocolResponse(response);
}

function authorizeTenant(state: AuthenticatedState): TenantState | Response {
  const { authContext, env, request } = state;
  const tenant = resolveTenant(request, env);
  if (!canAccessTenant(authContext, tenant)) {
    const response = errorResponse(403, ErrorCode.Forbidden, "Token cannot access this team");
    return protocolResponse(response);
  }

  return { ...state, tenant };
}

async function handleTenantRoute(state: TenantState): Promise<Response> {
  const { authContext, ctx, env, request, tenant, url } = state;

  if (url.pathname === ARTIFACT_EVENTS_PATH) {
    const response = await handleEvents(request, env, ctx);
    return protocolResponse(response);
  }

  if (url.pathname === ARTIFACTS_PATH || url.pathname === `${ARTIFACTS_PATH}/`) {
    const response = await handleArtifactLookup(request, env, tenant);
    return protocolResponse(response);
  }

  const artifactId = parseArtifactId(url.pathname);
  if (artifactId === null) {
    const response = errorResponse(404, ErrorCode.NotFound, "Not found");
    return protocolResponse(response);
  }

  const response = await handleArtifact(request, env, ctx, tenant, artifactId, authContext);
  return protocolResponse(response);
}

function protocolResponse(response: Response): Response {
  return withProtocolHeaders(response);
}

function isTurboPath(pathname: string): boolean {
  return pathname.startsWith(`${TURBO_API_PREFIX}/`);
}

function parseArtifactId(pathname: string): string | null {
  if (!pathname.startsWith(ARTIFACT_ITEM_PREFIX)) {
    return null;
  }

  const encodedArtifactId = pathname.slice(ARTIFACT_ITEM_PREFIX.length);
  if (encodedArtifactId.length === 0 || encodedArtifactId.includes("/")) {
    return null;
  }

  try {
    const artifactId = decodeURIComponent(encodedArtifactId);
    return artifactId.length > 0 ? artifactId : null;
  } catch {
    return null;
  }
}
