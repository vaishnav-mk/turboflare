import type { Env } from "./app/env";
import { handleRequest } from "./app/router";
import { ErrorCode, errorResponse } from "./http/response";
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
      return errorResponse(500, ErrorCode.InternalError, "Internal server error");
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const cleanup = cleanupExpiredArtifacts(env);
    const guardedCleanup = cleanup.catch(logCleanupFailure);
    ctx.waitUntil(guardedCleanup);
  },
} satisfies ExportedHandler<Env>;

function logCleanupFailure(err: unknown): void {
  console.error("cleanup failed", err);
}
