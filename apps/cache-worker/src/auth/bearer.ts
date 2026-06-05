import type { Env } from "../app/env";
import type { TenantContext } from "../tenancy/types";
import { readBearerToken, timingSafeEqual } from "./bearer-token";
import { ALL_TEAMS, MAX_BEARER_TOKEN_LENGTH } from "./constants";
import { authenticateD1Token } from "./d1";
import { parseAllowedTokens, parseScopedTokens } from "./static";
import { type AuthContext, AuthScope, type StaticTokenRule } from "./types";

let cachedRawTokens: string | undefined;
let cachedRawScopedTokens: string | undefined;
let cachedTokenRules: readonly StaticTokenRule[] = [];

export async function authenticateBearer(request: Request, env: Env): Promise<AuthContext | null> {
	const token = readBearerToken(request);
	if (token === null || token.length > MAX_BEARER_TOKEN_LENGTH) {
		return null;
	}

	const rule = tokenRules(env).find((tokenRule) => timingSafeEqual(token, tokenRule.token));
	if (rule !== undefined) {
		return {
			allowedTeams: rule.teams,
			scopes: rule.scopes,
			tokenId: rule.id ?? "static",
		};
	}

	return authenticateD1Token(env, token);
}

export function hasScope(authContext: AuthContext, scope: AuthScope): boolean {
	return authContext.scopes.includes(scope);
}

export function canAccessTenant(authContext: AuthContext, tenant: TenantContext): boolean {
	return authContext.allowedTeams.includes(ALL_TEAMS) || authContext.allowedTeams.includes(tenant.key);
}

function tokenRules(env: Env): readonly StaticTokenRule[] {
	if (env.TURBO_TOKEN === cachedRawTokens && env.TURBO_TOKEN_SCOPES === cachedRawScopedTokens) {
		return cachedTokenRules;
	}

	cachedRawTokens = env.TURBO_TOKEN;
	cachedRawScopedTokens = env.TURBO_TOKEN_SCOPES;
	cachedTokenRules = [...parseAllowedTokens(env.TURBO_TOKEN), ...parseScopedTokens(env.TURBO_TOKEN_SCOPES)];
	return cachedTokenRules;
}
