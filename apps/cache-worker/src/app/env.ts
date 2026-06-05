import { CacheStatus, isCacheStatus } from "@turboflare/protocol";

export enum ArtifactStore {
	Kv = "kv",
	R2 = "r2",
}

export interface Env {
	ANALYTICS?: AnalyticsEngineDataset;
	ARTIFACT_INDEX?: D1Database;
	ARTIFACT_STORE?: string;
	ARTIFACTS_KV?: KVNamespace;
	ARTIFACTS: R2Bucket;
	CACHE_API_MAX_BYTES?: string;
	CACHE_API_READS?: string;
	CACHE_STATUS?: string;
	CLEANUP_MAX_DELETE?: string;
	INTERNAL_ADMIN_TOKEN?: string;
	MAX_ARTIFACT_BYTES?: string;
	RATE_LIMITER?: RateLimit;
	READ_ONLY?: string;
	RETENTION_DAYS?: string;
	TOKEN_DB?: D1Database;
	TURBO_TOKEN?: string;
	TURBO_TOKEN_SCOPES?: string;
}

export interface AppConfig {
	artifactStore: ArtifactStore;
	cacheApiMaxBytes: number;
	cacheApiReads: boolean;
	cacheStatus: CacheStatus;
	cleanupMaxDelete: number;
	internalAdminToken?: string;
	maxArtifactBytes: number;
	readOnly: boolean;
	retentionDays: number;
}

const DEFAULT_CACHE_API_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_CLEANUP_MAX_DELETE = 1000;
const DEFAULT_RETENTION_DAYS = 30;

export function appConfig(env: Env): AppConfig {
	return {
		artifactStore: artifactStore(env.ARTIFACT_STORE),
		cacheApiMaxBytes: numberValue(env.CACHE_API_MAX_BYTES, DEFAULT_CACHE_API_MAX_BYTES),
		cacheApiReads: isTruthy(env.CACHE_API_READS),
		cacheStatus: env.CACHE_STATUS !== undefined && isCacheStatus(env.CACHE_STATUS) ? env.CACHE_STATUS : CacheStatus.Enabled,
		cleanupMaxDelete: numberValue(env.CLEANUP_MAX_DELETE, DEFAULT_CLEANUP_MAX_DELETE),
		internalAdminToken: nonEmptyValue(env.INTERNAL_ADMIN_TOKEN),
		maxArtifactBytes: numberValue(env.MAX_ARTIFACT_BYTES, 0),
		readOnly: isTruthy(env.READ_ONLY),
		retentionDays: numberValue(env.RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
	};
}

function artifactStore(value: string | undefined): ArtifactStore {
	return value?.toLowerCase() === ArtifactStore.Kv ? ArtifactStore.Kv : ArtifactStore.R2;
}

function nonEmptyValue(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function isTruthy(value: string | undefined): boolean {
	const normalized = value?.toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

function numberValue(value: string | undefined, fallback: number): number {
	if (value === undefined) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
