import { ARTIFACT_RESPONSE_HEADERS } from "@turboflare/protocol";

export function withProtocolHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  const exposedHeaders = ARTIFACT_RESPONSE_HEADERS.join(", ");
  headers.set("Access-Control-Expose-Headers", exposedHeaders);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
