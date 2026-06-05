import type { Env } from "../../app/env";
import { jsonResponse, methodNotAllowed } from "../../http/response";
import { cleanupExpiredArtifacts } from "../../storage/cleanup";

const PURGE_EXPIRED_PATH = "/internal/artifacts/purge-expired";

export async function handleInternalArtifacts(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== PURGE_EXPIRED_PATH) {
		return null;
	}

	if (request.method !== "POST") {
		return methodNotAllowed(["POST"]);
	}

	return jsonResponse(await cleanupExpiredArtifacts(env));
}
