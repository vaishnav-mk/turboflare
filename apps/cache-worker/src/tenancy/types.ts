export enum TenantSource {
  Global = "global",
  Slug = "slug",
  Team = "team",
  TeamId = "teamId",
}

export interface TenantContext {
  branch?: string;
  fallbackBranch?: string;
  key: string;
  readOnly: boolean;
  source: TenantSource;
}
