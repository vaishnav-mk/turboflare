import { TenantSource, type TenantContext } from "./types";

const GLOBAL_TENANT_KEY = "global";

export function resolveTenant(url: URL): TenantContext {
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
