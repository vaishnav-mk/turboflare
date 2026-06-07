export const TURBO_API_PREFIX = "/v8";
export const ARTIFACTS_PATH = `${TURBO_API_PREFIX}/artifacts`;
export const ARTIFACT_STATUS_PATH = `${ARTIFACTS_PATH}/status`;
export const ARTIFACT_EVENTS_PATH = `${ARTIFACTS_PATH}/events`;

export enum HttpMethod {
	Get = "GET",
	Head = "HEAD",
	Options = "OPTIONS",
	Post = "POST",
	Put = "PUT",
}

export enum ArtifactHeader {
	ClientCi = "x-artifact-client-ci",
	ClientInteractive = "x-artifact-client-interactive",
	DirtyHash = "x-artifact-dirty-hash",
	Duration = "x-artifact-duration",
	Sha = "x-artifact-sha",
	Tag = "x-artifact-tag",
}

export const ARTIFACT_RESPONSE_HEADERS = [
	"Content-Length",
	"ETag",
	"Last-Modified",
	ArtifactHeader.Duration,
	ArtifactHeader.Tag,
	ArtifactHeader.Sha,
	ArtifactHeader.DirtyHash,
] as const;

export const PREFLIGHT_ALLOW_HEADERS = [
	"Authorization",
	"Content-Type",
	"User-Agent",
	ArtifactHeader.Duration,
	ArtifactHeader.Tag,
	ArtifactHeader.Sha,
	ArtifactHeader.DirtyHash,
	ArtifactHeader.ClientCi,
	ArtifactHeader.ClientInteractive,
] as const;

export const PREFLIGHT_ALLOW_METHODS = [HttpMethod.Get, HttpMethod.Head, HttpMethod.Put, HttpMethod.Post, HttpMethod.Options] as const;

export enum CacheStatus {
	Disabled = "disabled",
	Enabled = "enabled",
	OverLimit = "over_limit",
	Paused = "paused",
}

export interface CacheStatusResponse {
	status: CacheStatus;
}

export interface ArtifactLookupRequest {
	hashes: string[];
}

export interface ArtifactLookupHit {
	size: number;
	taskDurationMs: number;
	tag?: string;
}

export type ArtifactLookupResponse = Record<string, ArtifactLookupHit | null>;

export enum CacheEventType {
	Hit = "HIT",
	Miss = "MISS",
}

export enum CacheEventSource {
	Local = "LOCAL",
	Remote = "REMOTE",
}

const CACHE_STATUSES = new Set<string>(Object.values(CacheStatus));

export function isCacheStatus(value: string): value is CacheStatus {
	return CACHE_STATUSES.has(value);
}
