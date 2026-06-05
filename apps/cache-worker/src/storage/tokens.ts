import type { Env } from "../app/env";
import { MAX_BEARER_TOKEN_LENGTH } from "../auth/constants";
import { hashToken } from "../auth/d1";
import { parseAuthScopes, parseAuthScopesJson, parseTeamKeys, parseTeamKeysJson } from "../auth/token-fields";
import { AuthScope } from "../auth/types";
import { base64UrlBytes } from "../shared/base64";

export interface TokenRecord {
	expiresAt: string | null;
	id: string;
	revokedAt: string | null;
	scopes: readonly AuthScope[];
	teams: readonly string[];
}

export interface CreatedToken extends TokenRecord {
	token: string;
}

export interface RevokedToken {
	id: string;
	revokedAt: string;
}

export interface CreateTokenInput {
	expiresAt?: unknown;
	id?: unknown;
	scopes?: unknown;
	teams?: unknown;
	token?: unknown;
}

interface TokenRow {
	expires_at?: string | null;
	id: string;
	revoked_at?: string | null;
	scopes: string;
	teams: string;
}

type TokenResult = { error: string } | { token: CreatedToken };

const CREATE_TOKEN_QUERY = "insert into tokens (id, token_hash, teams, scopes, expires_at, revoked_at) values (?, ?, ?, ?, ?, null)";
const INSERT_AUDIT_QUERY = "insert into token_audit (id, token_id, action, created_at) values (?, ?, ?, ?)";
const LIST_TOKENS_QUERY = "select id, teams, scopes, expires_at, revoked_at from tokens order by id";
const REVOKE_TOKEN_QUERY = "update tokens set revoked_at = ? where id = ? and revoked_at is null";

export async function listTokens(env: Env): Promise<readonly TokenRecord[] | null> {
	if (env.TOKEN_DB === undefined) {
		return null;
	}

	const result = await env.TOKEN_DB.prepare(LIST_TOKENS_QUERY).all<TokenRow>();
	return (result.results ?? []).map(tokenRecord);
}

export async function createToken(env: Env, input: CreateTokenInput): Promise<TokenResult | null> {
	if (env.TOKEN_DB === undefined) {
		return null;
	}

	const parsed = parseCreateToken(input);
	if (typeof parsed === "string") {
		return { error: parsed };
	}

	const tokenHash = await hashToken(parsed.token);
	await env.TOKEN_DB.prepare(CREATE_TOKEN_QUERY)
		.bind(parsed.id, tokenHash, JSON.stringify(parsed.teams), JSON.stringify(parsed.scopes), parsed.expiresAt)
		.run();
	await auditTokenAction(env, parsed.id, "create");

	return { token: { expiresAt: parsed.expiresAt, id: parsed.id, revokedAt: null, scopes: parsed.scopes, teams: parsed.teams, token: parsed.token } };
}

export async function revokeToken(env: Env, tokenId: string, now = new Date()): Promise<RevokedToken | null> {
	if (env.TOKEN_DB === undefined) {
		return null;
	}

	const revokedAt = now.toISOString();
	await env.TOKEN_DB.prepare(REVOKE_TOKEN_QUERY).bind(revokedAt, tokenId).run();
	await auditTokenAction(env, tokenId, "revoke", now);
	return { id: tokenId, revokedAt };
}

async function auditTokenAction(env: Env, tokenId: string, action: "create" | "revoke", now = new Date()): Promise<void> {
	await env.TOKEN_DB?.prepare(INSERT_AUDIT_QUERY).bind(crypto.randomUUID(), tokenId, action, now.toISOString()).run();
}

function parseCreateToken(input: CreateTokenInput): Omit<CreatedToken, "revokedAt"> | string {
	const id = input.id === undefined ? `tok_${crypto.randomUUID()}` : parseId(input.id);
	const token = input.token === undefined ? generatedToken() : parseRawToken(input.token);
	const teams = parseTeams(input.teams);
	const scopes = parseScopes(input.scopes);
	const expiresAt = parseExpiresAt(input.expiresAt);

	if (id === null) {
		return "id must contain only letters, numbers, dots, underscores, colons, or dashes";
	}

	if (token === null) {
		return "token must be a non-empty string no longer than 512 characters";
	}

	if (teams.length === 0) {
		return "teams must be a non-empty string array";
	}

	if (scopes.length === 0) {
		return "scopes must include read or write";
	}

	if (expiresAt === false) {
		return "expiresAt must be an ISO timestamp";
	}

	return { expiresAt, id, scopes, teams, token };
}

function tokenRecord(row: TokenRow): TokenRecord {
	return {
		expiresAt: row.expires_at ?? null,
		id: row.id,
		revokedAt: row.revoked_at ?? null,
		scopes: parseAuthScopesJson(row.scopes),
		teams: parseTeamKeysJson(row.teams),
	};
}

function parseId(value: unknown): string | null {
	return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

function parseRawToken(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_BEARER_TOKEN_LENGTH ? value : null;
}

function parseTeams(value: unknown): readonly string[] {
	return parseTeamKeys(value);
}

function parseScopes(value: unknown): readonly AuthScope[] {
	return parseAuthScopes(value);
}

function parseExpiresAt(value: unknown): string | null | false {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		return false;
	}

	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString() : false;
}

function generatedToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `tf_${base64UrlBytes(bytes)}`;
}
