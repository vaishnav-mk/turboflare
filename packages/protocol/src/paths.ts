export enum TurboRouteVersion {
  Api = "v8",
  Identity = "v2",
}

export type InternalRoutePrefix = "/internal";
export type TurboApiRoutePrefix = `/${TurboRouteVersion.Api}`;
export type TurboIdentityRoutePrefix = `/${TurboRouteVersion.Identity}`;

export interface RoutePrefixMap {
  Internal: InternalRoutePrefix;
  TurboApi: TurboApiRoutePrefix;
  TurboIdentity: TurboIdentityRoutePrefix;
}

export const RoutePrefix: RoutePrefixMap = {
  Internal: "/internal",
  TurboApi: `/${TurboRouteVersion.Api}`,
  TurboIdentity: `/${TurboRouteVersion.Identity}`,
};

export type RoutePrefix = (typeof RoutePrefix)[keyof typeof RoutePrefix];

export interface RoutePathMap {
  Root: "/";
  ManagementHealth: "/management/health";
  InternalHealth: `${InternalRoutePrefix}/health`;
  InternalMetricsSummary: `${InternalRoutePrefix}/metrics/summary`;
  InternalArtifactsPurgeExpired: `${InternalRoutePrefix}/artifacts/purge-expired`;
  InternalTeams: `${InternalRoutePrefix}/teams`;
  InternalTokens: `${InternalRoutePrefix}/tokens`;
  TurboArtifacts: `${TurboApiRoutePrefix}/artifacts`;
  TurboArtifactEvents: `${TurboApiRoutePrefix}/artifacts/events`;
  TurboArtifactStatus: `${TurboApiRoutePrefix}/artifacts/status`;
  TurboIdentityTeams: `${TurboIdentityRoutePrefix}/teams`;
  TurboIdentityUser: `${TurboIdentityRoutePrefix}/user`;
}

export const RoutePath: RoutePathMap = {
  Root: "/",
  ManagementHealth: "/management/health",
  InternalHealth: `${RoutePrefix.Internal}/health`,
  InternalMetricsSummary: `${RoutePrefix.Internal}/metrics/summary`,
  InternalArtifactsPurgeExpired: `${RoutePrefix.Internal}/artifacts/purge-expired`,
  InternalTeams: `${RoutePrefix.Internal}/teams`,
  InternalTokens: `${RoutePrefix.Internal}/tokens`,
  TurboArtifacts: `${RoutePrefix.TurboApi}/artifacts`,
  TurboArtifactEvents: `${RoutePrefix.TurboApi}/artifacts/events`,
  TurboArtifactStatus: `${RoutePrefix.TurboApi}/artifacts/status`,
  TurboIdentityTeams: `${RoutePrefix.TurboIdentity}/teams`,
  TurboIdentityUser: `${RoutePrefix.TurboIdentity}/user`,
};

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath];

export enum RouteAction {
  PurgeAll = "purge-all",
  Revoke = "revoke",
  Stats = "stats",
}

export const TURBO_API_PREFIX: TurboApiRoutePrefix = RoutePrefix.TurboApi;
export const ARTIFACTS_PATH: RoutePathMap["TurboArtifacts"] = RoutePath.TurboArtifacts;
export const ARTIFACT_STATUS_PATH: RoutePathMap["TurboArtifactStatus"] =
  RoutePath.TurboArtifactStatus;
export const ARTIFACT_EVENTS_PATH: RoutePathMap["TurboArtifactEvents"] =
  RoutePath.TurboArtifactEvents;
