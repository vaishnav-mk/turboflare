import { parseJsonArray, unique } from "../shared/json";
import { AuthScope } from "./types";

export function parseAuthScopes(value: unknown): readonly AuthScope[] {
  const values = arrayValue(value);
  const scopes: AuthScope[] = [];
  for (const scope of values) {
    if (isAuthScope(scope)) {
      scopes.push(scope);
    }
  }
  return unique(scopes);
}

export function parseAuthScopesJson(value: string): readonly AuthScope[] {
  const parsed = parseJsonArray(value);
  return parseAuthScopes(parsed);
}

export function parseTeamKeys(value: unknown): readonly string[] {
  const values = arrayValue(value);
  const teams = values.filter(
    (team): team is string => typeof team === "string" && team.length > 0,
  );
  return unique(teams);
}

export function parseTeamKeysJson(value: string): readonly string[] {
  const parsed = parseJsonArray(value);
  return parseTeamKeys(parsed);
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function isAuthScope(value: unknown): value is AuthScope {
  return value === AuthScope.Read || value === AuthScope.Write;
}
