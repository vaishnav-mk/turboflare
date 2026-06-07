import type { Env } from "../app/env";
import { MAX_BEARER_TOKEN_LENGTH } from "../auth/constants";
import {
  parseAuthScopes,
  parseAuthScopesJson,
  parseTeamKeys,
  parseTeamKeysJson,
} from "../auth/token-fields";
import { AuthScope, type D1TokenRow } from "../auth/types";
import { base64UrlBytes } from "../shared/base64";
import { sha256Hex } from "../shared/hash";

interface TokenRecord {
  expiresAt: string | null;
  id: string;
  revokedAt: string | null;
  scopes: readonly AuthScope[];
  teams: readonly string[];
}

interface CreatedToken extends TokenRecord {
  token: string;
}

interface RevokedToken {
  id: string;
  revokedAt: string;
}

interface CreateTokenInput {
  expiresAt?: unknown;
  id?: unknown;
  scopes?: unknown;
  teams?: unknown;
  token?: unknown;
}

type TokenResult = { error: string } | { token: CreatedToken };

const CREATE_TOKEN_QUERY =
  "insert into tokens (id, token_hash, teams, scopes, expires_at, revoked_at) values (?, ?, ?, ?, ?, null)";
const INSERT_AUDIT_QUERY =
  "insert into token_audit (id, token_id, action, created_at) values (?, ?, ?, ?)";
const LIST_TOKENS_QUERY =
  "select id, teams, scopes, expires_at, revoked_at from tokens order by id";
const REVOKE_TOKEN_QUERY = "update tokens set revoked_at = ? where id = ? and revoked_at is null";

export async function listTokens(env: Env): Promise<readonly TokenRecord[] | null> {
  if (env.TOKEN_DB === undefined) {
    return null;
  }

  const statement = env.TOKEN_DB.prepare(LIST_TOKENS_QUERY);
  const result = await statement.all<D1TokenRow>();
  const rows = result.results ?? [];
  const tokens = rows.map(tokenRecord);
  return tokens;
}

export async function createToken(env: Env, input: CreateTokenInput): Promise<TokenResult | null> {
  if (env.TOKEN_DB === undefined) {
    return null;
  }

  const parsed = parseCreateToken(input);
  if (typeof parsed === "string") {
    return { error: parsed };
  }

  const tokenHash = await sha256Hex(parsed.token);
  const teams = JSON.stringify(parsed.teams);
  const scopes = JSON.stringify(parsed.scopes);
  const statement = env.TOKEN_DB.prepare(CREATE_TOKEN_QUERY);
  const boundStatement = statement.bind(parsed.id, tokenHash, teams, scopes, parsed.expiresAt);
  try {
    await boundStatement.run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { error: "already_exists" };
    }
    throw error;
  }
  await auditTokenAction(env, parsed.id, "create");

  return {
    token: {
      expiresAt: parsed.expiresAt,
      id: parsed.id,
      revokedAt: null,
      scopes: parsed.scopes,
      teams: parsed.teams,
      token: parsed.token,
    },
  };
}

type RevokeResult = { error: "not_found" } | { revoked: RevokedToken };

export async function revokeToken(
  env: Env,
  tokenId: string,
  now = new Date(),
): Promise<RevokeResult | null> {
  if (env.TOKEN_DB === undefined) {
    return null;
  }

  const revokedAt = now.toISOString();
  const statement = env.TOKEN_DB.prepare(REVOKE_TOKEN_QUERY);
  const boundStatement = statement.bind(revokedAt, tokenId);
  const result = await boundStatement.run();
  if (result.meta?.changes === 0) {
    return { error: "not_found" };
  }
  await auditTokenAction(env, tokenId, "revoke", now);
  return { revoked: { id: tokenId, revokedAt } };
}

async function auditTokenAction(
  env: Env,
  tokenId: string,
  action: "create" | "revoke",
  now = new Date(),
): Promise<void> {
  const auditId = crypto.randomUUID();
  const createdAt = now.toISOString();
  const statement = env.TOKEN_DB?.prepare(INSERT_AUDIT_QUERY);
  const boundStatement = statement?.bind(auditId, tokenId, action, createdAt);
  await boundStatement?.run();
}

function parseCreateToken(input: CreateTokenInput): Omit<CreatedToken, "revokedAt"> | string {
  let id: string | null;
  if (input.id === undefined) {
    const generatedId = crypto.randomUUID();
    id = `tok_${generatedId}`;
  } else {
    id = parseId(input.id);
  }

  let token: string | null;
  if (input.token === undefined) {
    token = generatedToken();
  } else {
    token = parseRawToken(input.token);
  }
  const teams = parseTeamKeys(input.teams);
  const scopes = parseAuthScopes(input.scopes);
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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

function tokenRecord(row: D1TokenRow): TokenRecord {
  const scopes = parseAuthScopesJson(row.scopes);
  const teams = parseTeamKeysJson(row.teams);
  return {
    expiresAt: row.expires_at ?? null,
    id: row.id,
    revokedAt: row.revoked_at ?? null,
    scopes,
    teams,
  };
}

function parseId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const isValid = /^[A-Za-z0-9._:-]{1,128}$/.test(value);
  return isValid ? value : null;
}

function parseRawToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const isValid = value.length > 0 && value.length <= MAX_BEARER_TOKEN_LENGTH;
  return isValid ? value : null;
}

function parseExpiresAt(value: unknown): string | null | false {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return false;
  }

  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return false;
  }

  const expiresAt = new Date(time);
  return expiresAt.toISOString();
}

function generatedToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const encodedBytes = base64UrlBytes(bytes);
  return `tf_${encodedBytes}`;
}
