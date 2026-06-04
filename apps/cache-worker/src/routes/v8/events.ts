import { HttpMethod } from "@turboflare/protocol";
import { errorResponse, jsonResponse, methodNotAllowed } from "@turboflare/shared";

import type { Env } from "../../app/env";
import { recordMetric } from "../../observability/metrics";
import { MetricEvent } from "../../observability/types";

export async function handleEvents(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	if (request.method === HttpMethod.Get) {
		return jsonResponse([]);
	}

	if (request.method !== HttpMethod.Post) {
		return methodNotAllowed([HttpMethod.Get, HttpMethod.Post, HttpMethod.Options]);
	}

	let events: unknown;
	try {
		events = await request.json();
	} catch {
		return errorResponse(400, "bad_request", "Events request body must be JSON");
	}

	ctx.waitUntil(recordEvents(events));
	recordMetric(env, ctx, { event: MetricEvent.Events, method: request.method, status: 200 });
	return jsonResponse({ accepted: true });
}

async function recordEvents(_events: unknown): Promise<void> {
}
