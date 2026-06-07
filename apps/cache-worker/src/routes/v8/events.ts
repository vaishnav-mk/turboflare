import { CacheEventSource, CacheEventType, HttpMethod } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { ErrorCode, errorResponse, jsonResponse, methodNotAllowed } from "../../http/response";
import { recordMetric } from "../../observability/metrics";
import { MetricEvent } from "../../observability/types";
import { readBoundedJson } from "../../shared/json";
import { MAX_TURBO_JSON_BODY_BYTES } from "../../storage/constants";

export async function handleEvents(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method === HttpMethod.Get) {
    return jsonResponse([]);
  }

  if (request.method !== HttpMethod.Post) {
    return methodNotAllowed([HttpMethod.Get, HttpMethod.Post, HttpMethod.Options]);
  }

  let events: unknown;
  try {
    const body = await readBoundedJson(request, MAX_TURBO_JSON_BODY_BYTES);
    if (body.tooLarge) {
      return errorResponse(413, ErrorCode.PayloadTooLarge, "Events request body is too large");
    }
    events = body.value;
  } catch {
    return errorResponse(400, ErrorCode.BadRequest, "Events request body must be JSON");
  }

  if (!isEventArray(events)) {
    return errorResponse(
      400,
      ErrorCode.BadRequest,
      "Events request body must be an array of Turbo cache events",
    );
  }

  recordMetric(env, ctx, { event: MetricEvent.Events, method: request.method, status: 200 });
  return jsonResponse({ accepted: true });
}

function isEventArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(isEvent);
}

function isEvent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    (event.event === CacheEventType.Hit || event.event === CacheEventType.Miss) &&
    (event.source === CacheEventSource.Local || event.source === CacheEventSource.Remote) &&
    typeof event.hash === "string" &&
    typeof event.duration === "number" &&
    event.duration >= 0
  );
}
