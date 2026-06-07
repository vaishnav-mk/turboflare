import { PREFLIGHT_ALLOW_HEADERS, PREFLIGHT_ALLOW_METHODS } from "@turboflare/protocol";

const TURBOFLARE_EXTRA_HEADERS = ["x-turboflare-branch", "x-ai-agent"];

const ALLOW_HEADERS = [...PREFLIGHT_ALLOW_HEADERS, ...TURBOFLARE_EXTRA_HEADERS].join(", ");
const ALLOW_METHODS = PREFLIGHT_ALLOW_METHODS.join(", ");

export function preflightResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Headers": ALLOW_HEADERS,
			"Access-Control-Allow-Methods": ALLOW_METHODS,
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Max-Age": "86400",
		},
	});
}
