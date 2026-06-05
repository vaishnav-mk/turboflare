import { parseJsonArray, unique } from "../shared/json";
import { AuthScope } from "./types";

export function parseAuthScopes(value: unknown): readonly AuthScope[] {
	return unique(arrayValue(value).flatMap((scope) => (isAuthScope(scope) ? [scope] : [])));
}

export function parseAuthScopesJson(value: string): readonly AuthScope[] {
	return parseAuthScopes(parseJsonArray(value));
}

export function parseTeamKeys(value: unknown): readonly string[] {
	return unique(arrayValue(value).filter((team): team is string => typeof team === "string" && team.length > 0));
}

export function parseTeamKeysJson(value: string): readonly string[] {
	return parseTeamKeys(parseJsonArray(value));
}

function arrayValue(value: unknown): readonly unknown[] {
	return Array.isArray(value) ? value : [];
}

function isAuthScope(value: unknown): value is AuthScope {
	return value === AuthScope.Read || value === AuthScope.Write;
}
