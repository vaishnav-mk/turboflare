import { CacheStatus, isCacheStatus } from "@turboflare/protocol";

export interface Env {
	ARTIFACTS: R2Bucket;
	CACHE_STATUS?: string;
	READ_ONLY?: string;
	TURBO_TOKEN?: string;
	TURBO_TOKEN_SCOPES?: string;
}

export interface AppConfig {
	cacheStatus: CacheStatus;
	readOnly: boolean;
}

export function appConfig(env: Env): AppConfig {
	return {
		cacheStatus: env.CACHE_STATUS !== undefined && isCacheStatus(env.CACHE_STATUS) ? env.CACHE_STATUS : CacheStatus.Enabled,
		readOnly: isTruthy(env.READ_ONLY),
	};
}

function isTruthy(value: string | undefined): boolean {
	const normalized = value?.toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}
