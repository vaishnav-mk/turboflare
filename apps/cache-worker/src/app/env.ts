import { CacheStatus, isCacheStatus } from "@turboflare/protocol";

export interface Env {
	ANALYTICS?: AnalyticsEngineDataset;
	ARTIFACTS: R2Bucket;
	CACHE_API_MAX_BYTES?: string;
	CACHE_API_READS?: string;
	CACHE_STATUS?: string;
	INTERNAL_ACCESS_BYPASS?: string;
	READ_ONLY?: string;
	TURBO_TOKEN?: string;
	TURBO_TOKEN_SCOPES?: string;
}

export interface AppConfig {
	cacheApiMaxBytes: number;
	cacheApiReads: boolean;
	cacheStatus: CacheStatus;
	internalAccessBypass: boolean;
	readOnly: boolean;
}

const DEFAULT_CACHE_API_MAX_BYTES = 10 * 1024 * 1024;

export function appConfig(env: Env): AppConfig {
	return {
		cacheApiMaxBytes: numberValue(env.CACHE_API_MAX_BYTES, DEFAULT_CACHE_API_MAX_BYTES),
		cacheApiReads: isTruthy(env.CACHE_API_READS),
		cacheStatus: env.CACHE_STATUS !== undefined && isCacheStatus(env.CACHE_STATUS) ? env.CACHE_STATUS : CacheStatus.Enabled,
		internalAccessBypass: isTruthy(env.INTERNAL_ACCESS_BYPASS),
		readOnly: isTruthy(env.READ_ONLY),
	};
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
