import { ARTIFACT_RESPONSE_HEADERS } from "@turboflare/protocol";

const CACHE_ORIGIN = "https://turboflare-cache.invalid";

export function artifactCache(): Cache {
	return (caches as unknown as { default: Cache }).default;
}

export function cacheRequest(key: string): Request {
	return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`);
}

export function cacheableResponse(response: Response, key: string): Response {
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "public, max-age=31536000, immutable");
	headers.set("Cache-Tag", cacheTag(key));
	headers.set("Access-Control-Expose-Headers", ARTIFACT_RESPONSE_HEADERS.join(", "));
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function cacheTag(key: string): string {
	return `artifact:${key}`.replaceAll("/", ":");
}
