import { PREFLIGHT_ALLOW_HEADERS, PREFLIGHT_ALLOW_METHODS } from "@turboflare/protocol";

export function preflightResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Headers": PREFLIGHT_ALLOW_HEADERS,
			"Access-Control-Allow-Methods": PREFLIGHT_ALLOW_METHODS,
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Max-Age": "86400",
		},
	});
}
