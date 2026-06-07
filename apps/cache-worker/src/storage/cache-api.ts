import { ARTIFACT_RESPONSE_HEADERS } from "@turboflare/protocol";

const CACHE_ORIGIN = "https://turboflare-cache.invalid";
const EXPOSED_ARTIFACT_HEADERS = ARTIFACT_RESPONSE_HEADERS.join(", ");

export function artifactCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

export function cacheRequest(key: string): Request {
  const encodedKey = encodeURIComponent(key);
  return new Request(`${CACHE_ORIGIN}/${encodedKey}`);
}

export async function deleteCachedArtifacts(keys: readonly string[]): Promise<void> {
  const cache = artifactCache();
  const deletes = keys.map((key) => {
    const request = cacheRequest(key);
    return cache.delete(request);
  });
  const results = await Promise.allSettled(deletes);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    console.error(`cache api delete: ${failures.length}/${keys.length} failed`);
  }
}

export function cacheableResponse(response: Response, key: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Cache-Tag", `artifact:${key}`.replaceAll("/", ":"));
  headers.set("Access-Control-Expose-Headers", EXPOSED_ARTIFACT_HEADERS);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
