import type { Env } from "./app/env";
import { handleRequest } from "./app/router";
import { cleanupExpiredArtifacts } from "./storage/cleanup";

export { handleRequest } from "./app/router";
export { cleanupExpiredArtifacts } from "./storage/cleanup";
export type { Env } from "./app/env";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handleRequest(request, env, ctx);
	},
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(cleanupExpiredArtifacts(env));
	},
} satisfies ExportedHandler<Env>;
