export enum CacheStatus {
  Disabled = "disabled",
  Enabled = "enabled",
  OverLimit = "over_limit",
  Paused = "paused",
}

export interface CacheStatusResponse {
  status: CacheStatus;
}

const CACHE_STATUSES = new Set<string>(Object.values(CacheStatus));

export function isCacheStatus(value: string): value is CacheStatus {
  return CACHE_STATUSES.has(value);
}
