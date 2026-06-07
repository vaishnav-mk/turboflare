import {
  ARTIFACT_EVENTS_PATH,
  ARTIFACT_STATUS_PATH,
  ARTIFACTS_PATH,
  HttpMethod,
  RoutePath,
  TURBO_API_PREFIX,
} from "@turboflare/protocol";

import type { Env } from "./env";
import { authenticateBearer, canAccessTeam } from "../auth/bearer";
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

  if (!state.url.pathname.startsWith(`${TURBO_API_PREFIX}/`)) {
    return errorResponse(404, ErrorCode.NotFound, "Not found");
  }

  return handleTurboRoute(state);
}

function handlePublicRoute({ request, url }: RequestState): Response | null {
  if (request.method !== HttpMethod.Get) {
    return null;
  }

  switch (url.pathname) {
    case RoutePath.Root:
      return new Response("Turboflare remote cache\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    case RoutePath.ManagementHealth:
      return new Response(null, { status: 200 });
    default:
      return null;
  }
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
    return withProtocolHeaders(rateLimitError);
  }

  return handleTenantRoute(tenantState);
}

function handlePreflight({ env, request }: RequestState): Response | null {
  if (request.method !== HttpMethod.Options) {
    return null;
  }

  recordMetric(env, { event: MetricEvent.Preflight, method: request.method, status: 204 });
  return preflightResponse();
}

async function authenticateTurbo(state: RequestState): Promise<AuthenticatedState | Response> {
  const { env, request } = state;
  const authContext = await authenticateBearer(request, env);
  if (authContext === null) {
    return withProtocolHeaders(
      errorResponse(401, ErrorCode.Unauthorized, "Missing or invalid bearer token", {
        "WWW-Authenticate": "Bearer",
      }),
    );
  }

  const requiredScope = request.method === HttpMethod.Put ? AuthScope.Write : AuthScope.Read;
  if (!authContext.scopes.includes(requiredScope)) {
    const response = errorResponse(
      403,
      ErrorCode.Forbidden,
      "Token does not have the required scope",
    );
    return withProtocolHeaders(response);
  }

  return { ...state, authContext };
}

async function handleStatusRoute({
  authContext,
  env,
  request,
}: AuthenticatedState): Promise<Response> {
  const rateLimitError = await enforceRateLimit(env, authContext, null);
  if (rateLimitError !== null) {
    return withProtocolHeaders(rateLimitError);
  }

  const response = handleStatus(request, env);
  return withProtocolHeaders(response);
}

function authorizeTenant(state: AuthenticatedState): TenantState | Response {
  const { authContext, env, request } = state;
  const tenant = resolveTenant(request, env);
  if (!canAccessTeam(authContext, tenant.key)) {
    const response = errorResponse(403, ErrorCode.Forbidden, "Token cannot access this team");
    return withProtocolHeaders(response);
  }

  return { ...state, tenant };
}

async function handleTenantRoute(state: TenantState): Promise<Response> {
  const { authContext, ctx, env, request, tenant, url } = state;

  if (url.pathname === ARTIFACT_EVENTS_PATH) {
    const response = await handleEvents(request, env);
    return withProtocolHeaders(response);
  }

  if (url.pathname === ARTIFACTS_PATH || url.pathname === `${ARTIFACTS_PATH}/`) {
    const response = await handleArtifactLookup(request, env, tenant);
    return withProtocolHeaders(response);
  }

  const artifactId = parseArtifactId(url.pathname);
  if (artifactId === null) {
    const response = errorResponse(404, ErrorCode.NotFound, "Not found");
    return withProtocolHeaders(response);
  }

  const response = await handleArtifact(request, env, ctx, tenant, artifactId, authContext);
  return withProtocolHeaders(response);
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
