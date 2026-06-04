import { HttpMethod } from "@turboflare/protocol";
import { errorResponse, jsonResponse, methodNotAllowed } from "@turboflare/shared";

export async function handleEvents(request: Request, ctx: ExecutionContext): Promise<Response> {
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
	return jsonResponse({ accepted: true });
}

async function recordEvents(_events: unknown): Promise<void> {
}
