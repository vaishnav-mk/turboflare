import { ARTIFACT_RESPONSE_HEADERS } from "@turboflare/protocol";

const EXPOSED_ARTIFACT_HEADERS = ARTIFACT_RESPONSE_HEADERS.join(", ");

export function withProtocolHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", EXPOSED_ARTIFACT_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
