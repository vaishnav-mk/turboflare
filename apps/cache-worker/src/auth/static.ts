import { AuthScope, type StaticTokenRule } from "./types";
import { ALL_TEAMS, MAX_BEARER_TOKEN_LENGTH } from "./constants";
import { parseAuthScopes, parseTeamKeys } from "./token-fields";

export function parseAllowedTokens(rawTokens: string | undefined): readonly StaticTokenRule[] {
  if (rawTokens === undefined) {
    return [];
  }

  return rawTokens
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token.length <= MAX_BEARER_TOKEN_LENGTH)
    .map((token, index) => ({
      id: `static-${index}`,
      scopes: [AuthScope.Read, AuthScope.Write],
      teams: [ALL_TEAMS],
      token,
    }));
}

export function parseScopedTokens(rawTokens: string | undefined): readonly StaticTokenRule[] {
  if (rawTokens === undefined || rawTokens.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawTokens);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((value, index) => {
    const rule = parseScopedTokenRule(value, index);
    return rule === null ? [] : [rule];
  });
}

function parseScopedTokenRule(value: unknown, index: number): StaticTokenRule | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (
    typeof raw.token !== "string" ||
    raw.token.length === 0 ||
    raw.token.length > MAX_BEARER_TOKEN_LENGTH
  ) {
    return null;
  }

  const scopes = parseAuthScopes(raw.scopes);
  const teams = parseTeamKeys(raw.teams);
  if (scopes.length === 0 || teams.length === 0) {
    return null;
  }

  return {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `scoped-${index}`,
    scopes,
    teams,
    token: raw.token,
  };
}
