import { ARTIFACT_RESPONSE_HEADERS } from "@turboflare/protocol";

export function withProtocolHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set("Access-Control-Expose-Headers", ARTIFACT_RESPONSE_HEADERS.join(", "));
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
