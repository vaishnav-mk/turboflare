import type { Env } from "../app/env";
import { sha256Hex } from "../shared/hash";
import { readBearerToken } from "./bearer-token";
import { ALL_TEAMS, MAX_BEARER_TOKEN_LENGTH } from "./constants";
import { authenticateD1Token } from "./d1";
import { parseAllowedTokens, parseScopedTokens } from "./static";
import { type AuthContext, type StaticTokenRule } from "./types";

let cachedRawTokens: string | undefined;
let cachedRawScopedTokens: string | undefined;
let cachedTokenRules: readonly StaticTokenRule[] = [];

export async function authenticateBearer(request: Request, env: Env): Promise<AuthContext | null> {
  const token = readBearerToken(request);
  if (token === null) {
    return null;
  }
  if (token.length > MAX_BEARER_TOKEN_LENGTH) {
    return null;
  }

  const rules = tokenRules(env);
  const rule = await matchingTokenRule(token, rules);
  if (rule !== undefined) {
    return {
      allowedTeams: rule.teams,
      scopes: rule.scopes,
      tokenId: rule.id ?? "static",
    };
  }

  return authenticateD1Token(env, token);
}

export function canAccessTeam(authContext: AuthContext, teamKey: string): boolean {
  const hasAllTeams = authContext.allowedTeams.includes(ALL_TEAMS);
  const hasTeam = authContext.allowedTeams.includes(teamKey);
  return hasAllTeams || hasTeam;
}

function tokenRules(env: Env): readonly StaticTokenRule[] {
  if (env.TURBO_TOKEN === cachedRawTokens && env.TURBO_TOKEN_SCOPES === cachedRawScopedTokens) {
    return cachedTokenRules;
  }

  cachedRawTokens = env.TURBO_TOKEN;
  cachedRawScopedTokens = env.TURBO_TOKEN_SCOPES;
  cachedTokenRules = [
    ...parseAllowedTokens(env.TURBO_TOKEN),
    ...parseScopedTokens(env.TURBO_TOKEN_SCOPES),
  ];
  return cachedTokenRules;
}

async function matchingTokenRule(
  token: string,
  rules: readonly StaticTokenRule[],
): Promise<StaticTokenRule | undefined> {
  const tokenHash = await sha256Hex(token);
  for (const rule of rules) {
    const ruleHash = await sha256Hex(rule.token);
    if (tokenHash === ruleHash) {
      return rule;
    }
  }

  return undefined;
}
