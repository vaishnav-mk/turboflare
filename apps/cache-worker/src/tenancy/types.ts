export enum TenantSource {
	Global = "global",
	Slug = "slug",
	Team = "team",
	TeamId = "teamId",
}

export interface TenantContext {
	key: string;
	source: TenantSource;
}
