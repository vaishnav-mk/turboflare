import { errorResponse } from "@turboflare/shared";

import { appConfig, ArtifactStore, type Env } from "../app/env";
import { MAX_KV_VALUE_BYTES } from "./constants";
import { deleteKvArtifacts, getKvArtifact, headKvArtifact, putKvArtifact } from "./kv";
import type { ArtifactBodyObject, ArtifactMetadataObject } from "./metadata";
import { getR2Artifact, headR2Artifact, putR2Artifact } from "./r2";

export function artifactStoreUnavailable(env: Env): Response | null {
	return appConfig(env).artifactStore === ArtifactStore.Kv && env.ARTIFACTS_KV === undefined ? errorResponse(503, "unavailable", "KV artifact store is not configured") : null;
}

export function kvUploadLimitError(env: Env, contentLength: number | undefined): Response | null {
	const config = appConfig(env);
	if (config.artifactStore !== ArtifactStore.Kv) {
		return null;
	}

	if (contentLength === undefined) {
		return errorResponse(411, "length_required", "KV artifact store requires Content-Length");
	}

	const limit = config.maxArtifactBytes > 0 ? Math.min(config.maxArtifactBytes, MAX_KV_VALUE_BYTES) : MAX_KV_VALUE_BYTES;
	return contentLength > limit ? errorResponse(413, "artifact_too_large", "Artifact upload exceeds configured KV size limit") : null;
}

export function deleteStoredArtifacts(env: Env, keys: readonly string[]): Promise<void> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? deleteKvArtifacts(env, keys) : env.ARTIFACTS.delete([...keys]);
}

export function getArtifactObject(env: Env, key: string): Promise<ArtifactBodyObject | R2ObjectBody | null> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? getKvArtifact(env, key) : getR2Artifact(env, key);
}

export function headArtifactObject(env: Env, key: string): Promise<ArtifactMetadataObject | R2Object | null> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? headKvArtifact(env, key) : headR2Artifact(env, key);
}

export function putArtifactObject(env: Env, key: string, body: ReadableStream, customMetadata: Record<string, string>): Promise<ArtifactMetadataObject | R2Object> {
	return appConfig(env).artifactStore === ArtifactStore.Kv ? putKvArtifact(env, key, body, customMetadata) : putR2Artifact(env, key, body, customMetadata);
}
