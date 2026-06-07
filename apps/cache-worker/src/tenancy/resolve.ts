import { BranchCachePolicy, appConfig, type Env } from "../app/env";
import { TenantSource, type TenantContext } from "./types";

const GLOBAL_TENANT_KEY = "global";
export const BRANCH_HEADER = "x-turboflare-branch";

export function resolveTenant(request: Request, env: Env): TenantContext {
  const url = new URL(request.url);
  const baseTenant = resolveBaseTenant(url);
  const config = appConfig(env);
  if (config.branchCachePolicy === BranchCachePolicy.Shared) {
    return { ...baseTenant, readOnly: false };
  }

  const branchParam = url.searchParams.get("branch");
  const branchHeader = request.headers.get(BRANCH_HEADER);
  const rawBranch = branchParam ?? branchHeader;
  const explicitBranch = normalizedBranch(rawBranch);
  const inferredBranch = branchFromTenantKey(baseTenant.key);
  const branch = explicitBranch ?? inferredBranch;
  const tenant =
    inferredBranch === undefined || explicitBranch !== undefined
      ? baseTenant
      : { ...baseTenant, key: tenantKeyWithoutBranch(baseTenant.key) };

  if (branch === undefined) {
    return { ...tenant, readOnly: false };
  }

  if (branch === config.defaultBranch) {
    return config.branchCachePolicy === BranchCachePolicy.Isolated
      ? { ...tenant, branch, readOnly: false }
      : { ...tenant, readOnly: false };
  }

  if (config.branchCachePolicy === BranchCachePolicy.ReadOnlyPr) {
    return { ...tenant, readOnly: true };
  }

  return config.branchCachePolicy === BranchCachePolicy.MainWritePrRead
    ? { ...tenant, branch, fallbackBranch: "", readOnly: false }
    : { ...tenant, branch, readOnly: false };
}

function resolveBaseTenant(url: URL): Omit<TenantContext, "readOnly"> {
  const slug = url.searchParams.get("slug");
  if (slug !== null && slug.length > 0) {
    return { key: slug, source: TenantSource.Slug };
  }

  const teamId = url.searchParams.get("teamId");
  if (teamId !== null && teamId.length > 0) {
    return { key: teamId, source: TenantSource.TeamId };
  }

  const team = url.searchParams.get("team");
  if (team !== null && team.length > 0) {
    return { key: team, source: TenantSource.Team };
  }

  return { key: GLOBAL_TENANT_KEY, source: TenantSource.Global };
}

function normalizedBranch(value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function branchFromTenantKey(key: string): string | undefined {
  const separatorIndex = key.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) {
    return undefined;
  }

  return key.slice(separatorIndex + 1);
}

function tenantKeyWithoutBranch(key: string): string {
  const separatorIndex = key.lastIndexOf("@");
  return separatorIndex <= 0 ? key : key.slice(0, separatorIndex);
}
