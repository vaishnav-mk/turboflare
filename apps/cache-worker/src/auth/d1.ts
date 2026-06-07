import type { Env } from "../app/env";
import { sha256Hex } from "../shared/hash";
import { parseAuthScopesJson, parseTeamKeysJson } from "./token-fields";
import type { AuthContext, D1TokenRow } from "./types";

const TOKEN_HASH_QUERY =
  "select id, teams, scopes, expires_at, revoked_at from tokens where token_hash = ? limit 1";

export async function authenticateD1Token(
  env: Env,
  token: string,
  now = Date.now(),
): Promise<AuthContext | null> {
  if (env.TOKEN_DB === undefined) {
    return null;
  }

  const tokenHash = await hashToken(token);
  const statement = env.TOKEN_DB.prepare(TOKEN_HASH_QUERY);
  const boundStatement = statement.bind(tokenHash);
  const row = await boundStatement.first<D1TokenRow>();
  if (
    row === null ||
    (row.revoked_at !== null && row.revoked_at !== undefined) ||
    isExpired(row.expires_at, now)
  ) {
    return null;
  }

  const scopes = parseAuthScopesJson(row.scopes);
  const allowedTeams = parseTeamKeysJson(row.teams);
  if (scopes.length === 0 || allowedTeams.length === 0) {
    return null;
  }

  return { allowedTeams, scopes, tokenId: row.id };
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

function isExpired(value: string | null | undefined, now: number): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  const expiresAt = Date.parse(value);

  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
