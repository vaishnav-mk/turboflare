import { CacheStatus, isCacheStatus } from "@turboflare/protocol";

export interface Env {
	INTERNAL_ACCESS_AUD?: string;
	ANALYTICS?: AnalyticsEngineDataset;
	ARTIFACTS: R2Bucket;
	CACHE_API_MAX_BYTES?: string;
	CACHE_API_READS?: string;
	CACHE_STATUS?: string;
	INTERNAL_ACCESS_BYPASS?: string;
	INTERNAL_ACCESS_JWKS?: string;
	INTERNAL_ACCESS_JWKS_URL?: string;
	INTERNAL_ACCESS_TEAM_DOMAIN?: string;
	CLEANUP_MAX_DELETE?: string;
	RATE_LIMITER?: RateLimit;
	READ_ONLY?: string;
	RETENTION_DAYS?: string;
	TOKEN_DB?: D1Database;
	TURBO_TOKEN?: string;
	TURBO_TOKEN_SCOPES?: string;
}

export interface AppConfig {
	cacheApiMaxBytes: number;
	cacheApiReads: boolean;
	cacheStatus: CacheStatus;
	internalAccessAudiences: readonly string[];
	internalAccessBypass: boolean;
	internalAccessJwks?: string;
	internalAccessJwksUrl?: string;
	internalAccessTeamDomain?: string;
	cleanupMaxDelete: number;
	readOnly: boolean;
	retentionDays: number;
}

const DEFAULT_CACHE_API_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_CLEANUP_MAX_DELETE = 1000;
const DEFAULT_RETENTION_DAYS = 30;

export function appConfig(env: Env): AppConfig {
	return {
		cacheApiMaxBytes: numberValue(env.CACHE_API_MAX_BYTES, DEFAULT_CACHE_API_MAX_BYTES),
		cacheApiReads: isTruthy(env.CACHE_API_READS),
		cacheStatus: env.CACHE_STATUS !== undefined && isCacheStatus(env.CACHE_STATUS) ? env.CACHE_STATUS : CacheStatus.Enabled,
		internalAccessAudiences: csvValue(env.INTERNAL_ACCESS_AUD),
		internalAccessBypass: isTruthy(env.INTERNAL_ACCESS_BYPASS),
		internalAccessJwks: nonEmptyValue(env.INTERNAL_ACCESS_JWKS),
		internalAccessJwksUrl: nonEmptyValue(env.INTERNAL_ACCESS_JWKS_URL),
		internalAccessTeamDomain: normalizeAccessTeamDomain(env.INTERNAL_ACCESS_TEAM_DOMAIN),
		cleanupMaxDelete: numberValue(env.CLEANUP_MAX_DELETE, DEFAULT_CLEANUP_MAX_DELETE),
		readOnly: isTruthy(env.READ_ONLY),
		retentionDays: numberValue(env.RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
	};
}

function csvValue(value: string | undefined): readonly string[] {
	return value === undefined
		? []
		: value
				.split(",")
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);
}

function nonEmptyValue(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function normalizeAccessTeamDomain(value: string | undefined): string | undefined {
	const trimmed = nonEmptyValue(value)?.replace(/\/+$/, "");
	if (trimmed === undefined) {
		return undefined;
	}

	return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
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
