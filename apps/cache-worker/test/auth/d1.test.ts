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
		const env = tokenEnv({ [tokenHash]: row({ id: "db-token", scopes: [AuthScope.Read, AuthScope.Write], teams: ["team_a"] }) });

		expect(await authenticateD1Token(env, token)).toEqual({ allowedTeams: ["team_a"], scopes: [AuthScope.Read, AuthScope.Write], tokenId: "db-token" });
	});

	it("rejects expired and revoked tokens", async ({ expect }) => {
		const expired = "expired-token";
		const revoked = "revoked-token";
		const env = tokenEnv({
			[await hashToken(expired)]: row({ expiresAt: "2020-01-01T00:00:00.000Z", id: "expired", scopes: [AuthScope.Read], teams: ["team_a"] }),
			[await hashToken(revoked)]: row({ id: "revoked", revokedAt: "2026-01-01T00:00:00.000Z", scopes: [AuthScope.Read], teams: ["team_a"] }),
		});

		expect(await authenticateD1Token(env, expired, Date.parse("2026-01-01T00:00:00.000Z"))).toBeNull();
		expect(await authenticateD1Token(env, revoked)).toBeNull();
	});

	it("rejects malformed scope and team rows", async ({ expect }) => {
		const badScopes = "bad-scopes";
		const badTeams = "bad-teams";
		const env = tokenEnv({
			[await hashToken(badScopes)]: { expires_at: null, id: "bad-scopes", revoked_at: null, scopes: JSON.stringify(["owner"]), teams: JSON.stringify(["team_a"]) },
			[await hashToken(badTeams)]: { expires_at: null, id: "bad-teams", revoked_at: null, scopes: JSON.stringify([AuthScope.Read]), teams: "not-json" },
		});

		expect(await authenticateD1Token(env, badScopes)).toBeNull();
		expect(await authenticateD1Token(env, badTeams)).toBeNull();
	});
});

function row(input: { expiresAt?: string; id: string; revokedAt?: string; scopes: AuthScope[]; teams: string[] }): Row {
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
