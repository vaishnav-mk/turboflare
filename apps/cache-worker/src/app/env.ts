import { CacheStatus, isCacheStatus } from "@turboflare/protocol";

export enum ArtifactStore {
  Kv = "kv",
  R2 = "r2",
}

export enum BranchCachePolicy {
  Isolated = "isolated",
  MainWritePrRead = "main-write-pr-read",
  ReadOnlyPr = "read-only-pr",
  Shared = "shared",
}

export enum SignaturePolicy {
  Accept = "accept",
  Monitor = "monitor",
  Off = "off",
  Require = "require",
}

export interface Env {
  ANALYTICS?: AnalyticsEngineDataset;
  ARTIFACT_INDEX?: D1Database;
  ARTIFACT_STORE?: string;
  ARTIFACTS_KV?: KVNamespace;
  ARTIFACTS: R2Bucket;
  BRANCH_CACHE_POLICY?: string;
  BRANCH_RETENTION_DAYS?: string;
  CACHE_API_MAX_BYTES?: string;
  CACHE_API_READS?: string;
  CACHE_STATUS?: string;
  CLEANUP_MAX_DELETE?: string;
  DEFAULT_BRANCH?: string;
  INTERNAL_ADMIN_TOKEN?: string;
  MAX_ARTIFACT_BYTES?: string;
  RATE_LIMITER?: RateLimit;
  READ_ONLY?: string;
  RETENTION_DAYS?: string;
  SIGNATURE_POLICY?: string;
  TOKEN_DB?: D1Database;
  TURBO_TOKEN?: string;
  TURBO_TOKEN_SCOPES?: string;
}

export interface AppConfig {
  artifactStore: ArtifactStore;
  branchCachePolicy: BranchCachePolicy;
  branchRetentionDays: number;
  cacheApiMaxBytes: number;
  cacheApiReads: boolean;
  cacheStatus: CacheStatus;
  cleanupMaxDelete: number;
  defaultBranch: string;
  internalAdminToken?: string;
  maxArtifactBytes: number;
  readOnly: boolean;
  retentionDays: number;
  signaturePolicy: SignaturePolicy;
}

const DEFAULT_CACHE_API_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_CLEANUP_MAX_DELETE = 1000;
const DEFAULT_MAX_ARTIFACT_BYTES = 500 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;

let cachedConfig: AppConfig | undefined;
let cachedConfigKey: string | undefined;

export function appConfig(env: Env): AppConfig {
  const key = `${env.ARTIFACT_STORE}|${env.BRANCH_CACHE_POLICY}|${env.BRANCH_RETENTION_DAYS}|${env.CACHE_API_MAX_BYTES}|${env.CACHE_API_READS}|${env.CACHE_STATUS}|${env.CLEANUP_MAX_DELETE}|${env.DEFAULT_BRANCH}|${env.INTERNAL_ADMIN_TOKEN}|${env.MAX_ARTIFACT_BYTES}|${env.READ_ONLY}|${env.RETENTION_DAYS}|${env.SIGNATURE_POLICY}`;
  if (cachedConfig !== undefined && cachedConfigKey === key) {
    return cachedConfig;
  }

  const retentionDays = numberValue(env.RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
  cachedConfig = {
    artifactStore: artifactStore(env.ARTIFACT_STORE),
    branchCachePolicy: branchCachePolicy(env.BRANCH_CACHE_POLICY),
    branchRetentionDays: numberValue(env.BRANCH_RETENTION_DAYS, retentionDays),
    cacheApiMaxBytes: numberValue(env.CACHE_API_MAX_BYTES, DEFAULT_CACHE_API_MAX_BYTES),
    cacheApiReads: isTruthy(env.CACHE_API_READS),
    cacheStatus:
      env.CACHE_STATUS !== undefined && isCacheStatus(env.CACHE_STATUS)
        ? env.CACHE_STATUS
        : CacheStatus.Enabled,
    cleanupMaxDelete: numberValue(env.CLEANUP_MAX_DELETE, DEFAULT_CLEANUP_MAX_DELETE),
    defaultBranch: nonEmptyValue(env.DEFAULT_BRANCH) ?? "main",
    internalAdminToken: nonEmptyValue(env.INTERNAL_ADMIN_TOKEN),
    maxArtifactBytes: numberValue(env.MAX_ARTIFACT_BYTES, DEFAULT_MAX_ARTIFACT_BYTES),
    readOnly: isTruthy(env.READ_ONLY),
    retentionDays,
    signaturePolicy: signaturePolicy(env.SIGNATURE_POLICY),
  };
  cachedConfigKey = key;
  return cachedConfig;
}

function artifactStore(value: string | undefined): ArtifactStore {
  return value?.toLowerCase() === ArtifactStore.Kv ? ArtifactStore.Kv : ArtifactStore.R2;
}

function branchCachePolicy(value: string | undefined): BranchCachePolicy {
  switch (value?.toLowerCase()) {
    case BranchCachePolicy.Isolated:
      return BranchCachePolicy.Isolated;
    case BranchCachePolicy.MainWritePrRead:
      return BranchCachePolicy.MainWritePrRead;
    case BranchCachePolicy.ReadOnlyPr:
      return BranchCachePolicy.ReadOnlyPr;
    default:
      return BranchCachePolicy.Shared;
  }
}

function signaturePolicy(value: string | undefined): SignaturePolicy {
  switch (value?.toLowerCase()) {
    case SignaturePolicy.Accept:
      return SignaturePolicy.Accept;
    case SignaturePolicy.Monitor:
      return SignaturePolicy.Monitor;
    case SignaturePolicy.Require:
      return SignaturePolicy.Require;
    default:
      return SignaturePolicy.Off;
  }
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
