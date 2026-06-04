import type { Env } from "./app/env";
import { handleRequest } from "./app/router";

export { handleRequest } from "./app/router";
export type { Env } from "./app/env";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handleRequest(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
