import type { Env } from "./app/env";
import { handleRequest } from "./app/router";
import { errorResponse } from "./http/response";
import { cleanupExpiredArtifacts } from "./storage/cleanup";

export { handleRequest } from "./app/router";
export { cleanupExpiredArtifacts } from "./storage/cleanup";
export type { Env } from "./app/env";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			return await handleRequest(request, env, ctx);
		} catch (err) {
			console.error("unhandled error in fetch handler", err);
			return errorResponse(500, "internal_error", "Internal server error");
		}
	},
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(cleanupExpiredArtifacts(env).catch((err) => console.error("cleanup failed", err)));
	},
} satisfies ExportedHandler<Env>;
