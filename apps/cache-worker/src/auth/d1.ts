import type { Env } from "../app/env";
import { ALL_TEAMS } from "./constants";
import { AuthScope, type AuthContext } from "./types";

interface TokenRow {
	expires_at?: string | null;
	id: string;
	revoked_at?: string | null;
	scopes: string;
	teams: string;
}

const TOKEN_HASH_QUERY = "select id, teams, scopes, expires_at, revoked_at from tokens where token_hash = ? limit 1";

export async function authenticateD1Token(env: Env, token: string, now = Date.now()): Promise<AuthContext | null> {
	if (env.TOKEN_DB === undefined) {
		return null;
	}

	const tokenHash = await hashToken(token);
	const row = await env.TOKEN_DB.prepare(TOKEN_HASH_QUERY).bind(tokenHash).first<TokenRow>();
	if (row === null || row.revoked_at !== null && row.revoked_at !== undefined || isExpired(row.expires_at, now)) {
		return null;
	}

	const scopes = parseScopes(row.scopes);
	const allowedTeams = parseTeams(row.teams);
	if (scopes.length === 0 || allowedTeams.length === 0) {
		return null;
	}

	return { allowedTeams, scopes, tokenId: row.id };
}

export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseScopes(value: string): readonly AuthScope[] {
	return parseJsonArray(value).flatMap((scope) => (scope === AuthScope.Admin || scope === AuthScope.Read || scope === AuthScope.Write ? [scope] : []));
}

function parseTeams(value: string): readonly string[] {
	const teams = parseJsonArray(value).filter((team): team is string => typeof team === "string" && team.length > 0);
	return teams;
}

function parseJsonArray(value: string): unknown[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function isExpired(value: string | null | undefined, now: number): boolean {
	if (value === null || value === undefined) {
		return false;
	}

	const expiresAt = Date.parse(value);
	return Number.isFinite(expiresAt) && expiresAt <= now;
}
