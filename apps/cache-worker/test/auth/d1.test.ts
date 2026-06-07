import { describe, it } from "vitest";

import { authenticateD1Token, hashToken } from "../../src/auth/d1";
import { AuthScope } from "../../src/auth/types";
import type { Env } from "../../src/app/env";

interface Row {
  expires_at?: string | null;
  id: string;
  revoked_at?: string | null;
  scopes: string;
  teams: string;
}

describe("D1 token auth", () => {
  it("authenticates hashed token rows", async ({ expect }) => {
    const token = "d1-token";
    const tokenHash = await hashToken(token);
    const env = tokenEnv({
      [tokenHash]: row({
        id: "db-token",
        scopes: [AuthScope.Read, AuthScope.Write],
        teams: ["team_a"],
      }),
    });

    const result = await authenticateD1Token(env, token);
    expect(result).toEqual({
      allowedTeams: ["team_a"],
      scopes: [AuthScope.Read, AuthScope.Write],
      tokenId: "db-token",
    });
  });

  it("rejects expired, malformed, and revoked tokens", async ({ expect }) => {
    const expired = "expired-token";
    const malformed = "malformed-expiry-token";
    const revoked = "revoked-token";
    const expiredHash = await hashToken(expired);
    const malformedHash = await hashToken(malformed);
    const revokedHash = await hashToken(revoked);
    const env = tokenEnv({
      [expiredHash]: row({
        expiresAt: "2020-01-01T00:00:00.000Z",
        id: "expired",
        scopes: [AuthScope.Read],
        teams: ["team_a"],
      }),
      [malformedHash]: row({
        expiresAt: "not-a-date",
        id: "malformed",
        scopes: [AuthScope.Read],
        teams: ["team_a"],
      }),
      [revokedHash]: row({
        id: "revoked",
        revokedAt: "2026-01-01T00:00:00.000Z",
        scopes: [AuthScope.Read],
        teams: ["team_a"],
      }),
    });

    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const expiredResult = await authenticateD1Token(env, expired, now);
    expect(expiredResult).toBeNull();
    const malformedResult = await authenticateD1Token(env, malformed);
    expect(malformedResult).toBeNull();
    const revokedResult = await authenticateD1Token(env, revoked);
    expect(revokedResult).toBeNull();
  });

  it("rejects malformed scope and team rows", async ({ expect }) => {
    const badScopes = "bad-scopes";
    const badTeams = "bad-teams";
    const badScopesHash = await hashToken(badScopes);
    const badTeamsHash = await hashToken(badTeams);
    const env = tokenEnv({
      [badScopesHash]: {
        expires_at: null,
        id: "bad-scopes",
        revoked_at: null,
        scopes: JSON.stringify(["owner"]),
        teams: JSON.stringify(["team_a"]),
      },
      [badTeamsHash]: {
        expires_at: null,
        id: "bad-teams",
        revoked_at: null,
        scopes: JSON.stringify([AuthScope.Read]),
        teams: "not-json",
      },
    });

    const badScopesResult = await authenticateD1Token(env, badScopes);
    expect(badScopesResult).toBeNull();
    const badTeamsResult = await authenticateD1Token(env, badTeams);
    expect(badTeamsResult).toBeNull();
  });
});

function row(input: {
  expiresAt?: string;
  id: string;
  revokedAt?: string;
  scopes: AuthScope[];
  teams: string[];
}): Row {
  return {
    expires_at: input.expiresAt ?? null,
    id: input.id,
    revoked_at: input.revokedAt ?? null,
    scopes: JSON.stringify(input.scopes),
    teams: JSON.stringify(input.teams),
  };
}

function tokenEnv(rows: Record<string, Row>): Env {
  return {
    ARTIFACTS: {} as R2Bucket,
    TOKEN_DB: {
      prepare() {
        return {
          bind(tokenHash: string) {
            return {
              first: () => Promise.resolve(rows[tokenHash] ?? null),
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}
