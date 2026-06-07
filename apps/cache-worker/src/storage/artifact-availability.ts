import { appConfig, ArtifactStore, type Env } from "../app/env";
import { ErrorCode, errorResponse } from "../http/response";

export function artifactStoreUnavailable(env: Env): Response | null {
  return appConfig(env).artifactStore === ArtifactStore.Kv && env.ARTIFACTS_KV === undefined
    ? errorResponse(503, ErrorCode.Unavailable, "KV artifact store is not configured")
    : null;
}
