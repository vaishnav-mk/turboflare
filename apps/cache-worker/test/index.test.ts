import { env as workerEnv } from "cloudflare:workers";
import { SELF, createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, it } from "vitest";

import { CacheStatus } from "@turboflare/protocol";

import { handleRequest, type Env } from "../src";
import { hashToken } from "../src/auth/d1";
import { artifactCache, cacheRequest } from "../src/storage/cache-api";

const BASE_URL = "https://cache.turboflare.test";
const TOKEN = "test-token";
const ROTATED_TOKEN = "rotated-token";
const TEAM_ID = "team_turboflare";
const OTHER_TEAM_ID = "team_other";
const SCOPED_READ_TOKEN = "scoped-read-token";
const SCOPED_WRITE_TOKEN = "scoped-write-token";

interface AnalyticsPoint {
	blobs?: string[];
	doubles?: number[];
	indexes?: string[];
}

afterEach(async () => {
	await reset();
});

describe("cache worker", () => {
	it("serves a public health check", async ({ expect }) => {
		const response = await SELF.fetch(`${BASE_URL}/management/health`);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	it("separates internal health from Turbo bearer auth", async ({ expect }) => {
		const bearerOnly = await handleRequest(
			new Request(`${BASE_URL}/internal/health`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);
		expect(bearerOnly.status).toBe(401);
		expect(await bearerOnly.json()).toEqual({
			error: { code: "unauthorized", message: "Missing Cloudflare Access assertion" },
		});

		const bypassed = await handleRequest(
			new Request(`${BASE_URL}/internal/health`),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, INTERNAL_ACCESS_BYPASS: "true", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);
		expect(bypassed.status).toBe(200);
	});

	it("accepts valid Cloudflare Access assertions for internal routes", async ({ expect }) => {
		const access = await accessFixture();
		const response = await handleRequest(
			new Request(`${BASE_URL}/internal/health`, { headers: { "Cf-Access-Jwt-Assertion": access.token } }),
			{
				ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS,
				INTERNAL_ACCESS_AUD: access.audience,
				INTERNAL_ACCESS_JWKS: JSON.stringify({ keys: [access.publicJwk] }),
				INTERNAL_ACCESS_TEAM_DOMAIN: access.issuer,
				TURBO_TOKEN: TOKEN,
			},
			createExecutionContext()
		);

		expect(response.status).toBe(200);
	});

	it("rejects Access assertions with the wrong audience", async ({ expect }) => {
		const access = await accessFixture({ audience: "other-audience" });
		const response = await handleRequest(
			new Request(`${BASE_URL}/internal/health`, { headers: { "Cf-Access-Jwt-Assertion": access.token } }),
			{
				ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS,
				INTERNAL_ACCESS_AUD: "expected-audience",
				INTERNAL_ACCESS_JWKS: JSON.stringify({ keys: [access.publicJwk] }),
				INTERNAL_ACCESS_TEAM_DOMAIN: access.issuer,
				TURBO_TOKEN: TOKEN,
			},
			createExecutionContext()
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: { code: "forbidden", message: "Invalid Cloudflare Access assertion" },
		});
	});

	it("reports and purges internal team artifacts", async ({ expect }) => {
		const env = { ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, INTERNAL_ACCESS_BYPASS: "true", TURBO_TOKEN: TOKEN } satisfies Env;
		await env.ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/one`, new Uint8Array([1, 2]));
		await env.ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/two`, new Uint8Array([3]));
		await env.ARTIFACTS.put(`v1/team/${OTHER_TEAM_ID}/artifact/three`, new Uint8Array([4]));

		const stats = await handleRequest(new Request(`${BASE_URL}/internal/teams/${TEAM_ID}/stats`), env, createExecutionContext());
		expect(stats.status).toBe(200);
		expect(await stats.json()).toEqual({ bytes: 3, objects: 2, team: TEAM_ID });

		const purge = await handleRequest(new Request(`${BASE_URL}/internal/teams/${TEAM_ID}/purge-all`, { method: "POST" }), env, createExecutionContext());
		expect(purge.status).toBe(200);
		expect(await purge.json()).toEqual({ deleted: 2, team: TEAM_ID });

		expect(await env.ARTIFACTS.head(`v1/team/${TEAM_ID}/artifact/one`)).toBeNull();
		expect(await env.ARTIFACTS.head(`v1/team/${OTHER_TEAM_ID}/artifact/three`)).not.toBeNull();
	});

	it("creates lists and revokes internal tokens", async ({ expect }) => {
		const tokenDb = new TokenAdminDb();
		const env = { ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, INTERNAL_ACCESS_BYPASS: "true", TOKEN_DB: tokenDb as unknown as D1Database } satisfies Env;
		const expiresAt = "2027-01-01T00:00:00.000Z";

		const create = await handleRequest(
			new Request(`${BASE_URL}/internal/tokens`, {
				body: JSON.stringify({ expiresAt, id: "ci-token", scopes: ["read", "write"], teams: [TEAM_ID], token: "raw-token" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
			env,
			createExecutionContext()
		);

		expect(create.status).toBe(201);
		expect(await create.json()).toEqual({
			token: { expiresAt, id: "ci-token", revokedAt: null, scopes: ["read", "write"], teams: [TEAM_ID], token: "raw-token" },
		});
		expect(tokenDb.rows.get("ci-token")?.token_hash).toBe(await hashToken("raw-token"));

		const list = await handleRequest(new Request(`${BASE_URL}/internal/tokens`), env, createExecutionContext());
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({
			tokens: [{ expiresAt, id: "ci-token", revokedAt: null, scopes: ["read", "write"], teams: [TEAM_ID] }],
		});

		const revoke = await handleRequest(new Request(`${BASE_URL}/internal/tokens/ci-token/revoke`, { method: "POST" }), env, createExecutionContext());
		expect(revoke.status).toBe(200);
		expect(await revoke.json()).toEqual({ revoked: { id: "ci-token", revokedAt: expect.any(String) } });
		expect(tokenDb.rows.get("ci-token")?.revoked_at).toEqual(expect.any(String));
	});

	it("purges expired artifacts through the internal route", async ({ expect }) => {
		const bucket = new RouteCleanupBucket([
			{ key: `v1/team/${TEAM_ID}/artifact/old`, uploaded: daysAgo(40) },
			{ key: `v1/team/${TEAM_ID}/artifact/new`, uploaded: daysAgo(1) },
			{ key: `legacy/team/${TEAM_ID}/artifact/old`, uploaded: daysAgo(40) },
		]);
		const env = { ARTIFACTS: bucket as unknown as R2Bucket, INTERNAL_ACCESS_BYPASS: "true", RETENTION_DAYS: "30" } satisfies Env;

		const response = await handleRequest(new Request(`${BASE_URL}/internal/artifacts/purge-expired`, { method: "POST" }), env, createExecutionContext());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ deleted: 1, scanned: 2 });
		expect(bucket.deleted).toEqual([`v1/team/${TEAM_ID}/artifact/old`]);
	});

	it("requires token database for internal token routes", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}/internal/tokens`),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, INTERNAL_ACCESS_BYPASS: "true" },
			createExecutionContext()
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: { code: "unavailable", message: "Token database is not configured" },
		});
	});

	it("rejects unauthenticated Turbo requests", async ({ expect }) => {
		const response = await SELF.fetch(`${BASE_URL}/v8/artifacts/status`);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: {
				code: "unauthorized",
				message: "Missing or invalid bearer token",
			},
		});
	});

	it("reports enabled cache status", async ({ expect }) => {
		const response = await fetchAuthed("/v8/artifacts/status");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "enabled" });
	});

	it("reports configured cache status variants", async ({ expect }) => {
		for (const status of Object.values(CacheStatus)) {
			const response = await handleRequest(
				new Request(`${BASE_URL}/v8/artifacts/status`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
				{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_STATUS: status, TURBO_TOKEN: TOKEN },
				createExecutionContext()
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status });
		}
	});

	it("rejects invalid bearer tokens consistently", async ({ expect }) => {
		const response = await fetchAuthed("/v8/artifacts/status", {}, "bad-token");

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: {
				code: "unauthorized",
				message: "Missing or invalid bearer token",
			},
		});
	});

	it("accepts comma-separated bearer token allowlists", async ({ expect }) => {
		const response = await fetchAuthed("/v8/artifacts/status", {}, ROTATED_TOKEN);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "enabled" });
	});

	it("allows Turbo preflight headers", async ({ expect }) => {
		const response = await SELF.fetch(`${BASE_URL}/v8/artifacts/${randomArtifactId()}`, {
			method: "OPTIONS",
			headers: {
				"Access-Control-Request-Method": "PUT",
				"Access-Control-Request-Headers": "Authorization, Content-Type, x-artifact-duration",
			},
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
		expect(response.headers.get("access-control-allow-headers")).toContain("x-artifact-duration");
	});

	it("rejects rate-limited artifact requests", async ({ expect }) => {
		let key = "";
		const rateLimiter = {
			limit: async (input: { key: string }) => {
				key = input.key;
				return { success: false };
			},
		};

		const response = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${randomArtifactId()}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, RATE_LIMITER: rateLimiter as unknown as RateLimit, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(429);
		expect(key).toBe(`team:${TEAM_ID}:token:static-0`);
		expect(await response.json()).toEqual({
			error: { code: "rate_limited", message: "Rate limit exceeded" },
		});
	});

	it("streams artifact uploads and downloads through R2", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const body = new Uint8Array([1, 2, 3, 4, 5]);

		const put = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Length": body.byteLength.toString(),
				"Content-Type": "application/octet-stream",
				"x-artifact-client-ci": "GITHUB_ACTIONS",
				"x-artifact-client-interactive": "0",
				"x-artifact-dirty-hash": "dirty-hash",
				"x-artifact-duration": "1234",
				"x-artifact-sha": "sha-value",
				"x-artifact-tag": "build#app",
			},
			body,
		});

		expect(put.status).toBe(200);
		expect(await put.json()).toEqual({ urls: [] });

		const stored = await (workerEnv as unknown as Env).ARTIFACTS.head(`v1/team/${TEAM_ID}/artifact/${artifactId}`);
		expect(stored?.customMetadata).toMatchObject({
			artifactId,
			clientCi: "GITHUB_ACTIONS",
			clientInteractive: "0",
			dirtyHash: "dirty-hash",
			duration: "1234",
			sha: "sha-value",
			tag: "build#app",
			team: TEAM_ID,
			teamId: TEAM_ID,
			teamSource: "teamId",
			tokenId: "static-0",
		});
		expect(stored?.customMetadata?.createdAt).toEqual(expect.any(String));

		const get = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(get.headers.get("content-type")).toBe("application/octet-stream");
		expect(get.headers.get("content-length")).toBe(body.byteLength.toString());
		expect(get.headers.get("x-artifact-duration")).toBe("1234");
		expect(get.headers.get("x-artifact-tag")).toBe("build#app");
		expect(get.headers.get("x-artifact-sha")).toBe("sha-value");
		expect(get.headers.get("x-artifact-dirty-hash")).toBe("dirty-hash");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);

		const head = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
			method: "HEAD",
		});
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe(body.byteLength.toString());
		expect(head.headers.get("x-artifact-duration")).toBe("1234");
	});

	it("accepts incremental artifact ids", async ({ expect }) => {
		const artifactId = `incremental-${"a".repeat(64)}`;
		const body = new Uint8Array([9, 9, 9]);

		const put = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
				"x-artifact-duration": "0",
			},
			body,
		});

		expect(put.status).toBe(200);

		const get = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);

		const lookup = await fetchAuthed(`/v8/artifacts?teamId=${TEAM_ID}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ hashes: [artifactId] }),
		});

		expect(await lookup.json()).toEqual({
			[artifactId]: { size: body.byteLength, taskDurationMs: 0 },
		});
	});

	it("rejects unsupported upload content types", async ({ expect }) => {
		const response = await fetchAuthed(`/v8/artifacts/${randomArtifactId()}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: new Uint8Array([1]),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "bad_request",
				message: "Artifact upload must use application/octet-stream",
			},
		});
	});

	it("treats duplicate puts as last-writer-wins", async ({ expect }) => {
		const artifactId = randomArtifactId();

		const first = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream", "x-artifact-duration": "1", "x-artifact-tag": "first" },
			body: new Uint8Array([1]),
		});
		const second = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream", "x-artifact-duration": "2", "x-artifact-tag": "second" },
			body: new Uint8Array([2, 2]),
		});

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);

		const get = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.headers.get("x-artifact-duration")).toBe("2");
		expect(get.headers.get("x-artifact-tag")).toBe("second");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([2, 2]));
	});

	it("handles R2 objects without custom metadata", async ({ expect }) => {
		const artifactId = randomArtifactId();
		await (workerEnv as unknown as Env).ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/${artifactId}`, new Uint8Array([1, 2]), {
			httpMetadata: { contentType: "application/octet-stream" },
		});

		const get = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(get.headers.get("x-artifact-duration")).toBe("0");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
	});

	it("rejects oversized object keys", async ({ expect }) => {
		const artifactId = "x".repeat(1_200);
		const response = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream" },
			body: new Uint8Array([1]),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "bad_request",
				message: "Artifact key is too long",
			},
		});
	});

	it("returns misses without touching response bodies", async ({ expect }) => {
		const artifactId = randomArtifactId();

		const get = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(404);
		expect(await get.text()).toBe("");

		const head = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { method: "HEAD" });
		expect(head.status).toBe(404);
		expect(await head.text()).toBe("");
	});

	it("serves authenticated cache api hits after R2 fill", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const key = `v1/team/${TEAM_ID}/artifact/${artifactId}`;
		await (workerEnv as unknown as Env).ARTIFACTS.put(key, new Uint8Array([7]), {
			httpMetadata: { contentType: "application/octet-stream" },
			customMetadata: { duration: "7", tag: "cached" },
		});

		const fillCtx = createExecutionContext();
		const first = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			fillCtx
		);
		await waitOnExecutionContext(fillCtx);
		expect(first.status).toBe(200);

		await (workerEnv as unknown as Env).ARTIFACTS.delete(key);

		const cached = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(cached.status).toBe(200);
		expect(cached.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(cached.headers.get("cache-tag")).toBe(`artifact:${key.replaceAll("/", ":")}`);
		expect(cached.headers.get("x-artifact-tag")).toBe("cached");
		expect(new Uint8Array(await cached.arrayBuffer())).toEqual(new Uint8Array([7]));
		expect(await artifactCache().match(cacheRequest(key))).not.toBeUndefined();
	});

	it("keeps cache api entries scoped by team", async ({ expect }) => {
		const artifactId = randomArtifactId();
		await (workerEnv as unknown as Env).ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/${artifactId}`, new Uint8Array([1]), {
			httpMetadata: { contentType: "application/octet-stream" },
			customMetadata: { duration: "0" },
		});
		await (workerEnv as unknown as Env).ARTIFACTS.put(`v1/team/${OTHER_TEAM_ID}/artifact/${artifactId}`, new Uint8Array([2]), {
			httpMetadata: { contentType: "application/octet-stream" },
			customMetadata: { duration: "0" },
		});

		const firstCtx = createExecutionContext();
		const secondCtx = createExecutionContext();
		await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			firstCtx
		);
		await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${OTHER_TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			secondCtx
		);
		await waitOnExecutionContext(firstCtx);
		await waitOnExecutionContext(secondCtx);

		await (workerEnv as unknown as Env).ARTIFACTS.delete(`v1/team/${TEAM_ID}/artifact/${artifactId}`);
		await (workerEnv as unknown as Env).ARTIFACTS.delete(`v1/team/${OTHER_TEAM_ID}/artifact/${artifactId}`);

		const first = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);
		const second = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${OTHER_TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([1]));
		expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([2]));
	});

	it("skips cache api fill above size threshold", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const key = `v1/team/${TEAM_ID}/artifact/${artifactId}`;
		await (workerEnv as unknown as Env).ARTIFACTS.put(key, new Uint8Array([1, 2]), {
			httpMetadata: { contentType: "application/octet-stream" },
			customMetadata: { duration: "0" },
		});

		const ctx = createExecutionContext();
		const first = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_MAX_BYTES: "1", CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(first.status).toBe(200);
		expect(await artifactCache().match(cacheRequest(key))).toBeUndefined();

		await (workerEnv as unknown as Env).ARTIFACTS.delete(key);

		const miss = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_MAX_BYTES: "1", CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(miss.status).toBe(404);
	});

	it("rejects invalid artifact duration metadata", async ({ expect }) => {
		const response = await fetchAuthed(`/v8/artifacts/${randomArtifactId()}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
				"x-artifact-duration": "-1",
			},
			body: new Uint8Array([1]),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "bad_request",
				message: "x-artifact-duration must be a non-negative integer",
			},
		});
	});

	it("rejects writes in read-only mode", async ({ expect }) => {
		const ctx = createExecutionContext();
		const response = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"Content-Type": "application/octet-stream",
				},
				body: new Uint8Array([1]),
			}),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, READ_ONLY: "true", TURBO_TOKEN: TOKEN },
			ctx
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: {
				code: "forbidden",
				message: "Remote cache is running in read-only mode",
			},
		});
	});

	it("allows reads in read-only mode", async ({ expect }) => {
		const artifactId = randomArtifactId();
		await (workerEnv as unknown as Env).ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/${artifactId}`, new Uint8Array([1]), {
			httpMetadata: { contentType: "application/octet-stream" },
			customMetadata: { duration: "0" },
		});

		const ctx = createExecutionContext();
		const get = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, READ_ONLY: "true", TURBO_TOKEN: TOKEN },
			ctx
		);

		expect(get.status).toBe(200);
	});

	it("rejects scoped tokens without write scope", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${SCOPED_READ_TOKEN}`,
					"Content-Type": "application/octet-stream",
				},
				body: new Uint8Array([1]),
			}),
			scopedEnv(),
			createExecutionContext()
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: {
				code: "forbidden",
				message: "Token does not have the required scope",
			},
		});
	});

	it("rejects scoped tokens for other teams", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${randomArtifactId()}?teamId=${OTHER_TEAM_ID}`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${SCOPED_WRITE_TOKEN}`,
				},
			}),
			scopedEnv(),
			createExecutionContext()
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: {
				code: "forbidden",
				message: "Token cannot access this team",
			},
		});
	});

	it("allows scoped write tokens for their team", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const response = await handleRequest(
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${SCOPED_WRITE_TOKEN}`,
					"Content-Type": "application/octet-stream",
				},
				body: new Uint8Array([1, 2, 3]),
			}),
			scopedEnv(),
			createExecutionContext()
		);

		expect(response.status).toBe(200);
		const stored = await (workerEnv as unknown as Env).ARTIFACTS.head(`v1/team/${TEAM_ID}/artifact/${artifactId}`);
		expect(stored?.customMetadata?.tokenId).toBe("ci-write");
	});

	it("supports the team query alias used by existing cache servers", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const body = new Uint8Array([3, 1, 4]);

		const put = await fetchAuthed(`/v8/artifacts/${artifactId}?team=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
			},
			body,
		});
		expect(put.status).toBe(200);

		const get = await fetchAuthed(`/v8/artifacts/${artifactId}?team=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
	});

	it("scopes slug and teamId to separate R2 keys", async ({ expect }) => {
		const artifactId = randomArtifactId();
		await fetchAuthed(`/v8/artifacts/${artifactId}?slug=docs`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream" },
			body: new Uint8Array([1]),
		});
		await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=team_docs`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream" },
			body: new Uint8Array([2]),
		});

		const slugObject = await (workerEnv as unknown as Env).ARTIFACTS.head(`v1/team/docs/artifact/${artifactId}`);
		const teamIdObject = await (workerEnv as unknown as Env).ARTIFACTS.head(`v1/team/team_docs/artifact/${artifactId}`);
		expect(slugObject).not.toBeNull();
		expect(teamIdObject).not.toBeNull();
	});

	it("ignores x-ai-agent safely", async ({ expect }) => {
		const response = await fetchAuthed(`/v8/artifacts/${randomArtifactId()}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream", "x-ai-agent": "agent" },
			body: new Uint8Array([1]),
		});

		expect(response.status).toBe(200);
	});

	it("returns artifact lookup hits and misses", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const missingArtifactId = randomArtifactId();
		const body = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);

		const put = await fetchAuthed(`/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
				"x-artifact-duration": "42",
				"x-artifact-tag": "test#unit",
			},
			body,
		});
		expect(put.status).toBe(200);

		const lookup = await fetchAuthed(`/v8/artifacts?teamId=${TEAM_ID}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ hashes: [artifactId, missingArtifactId] }),
		});

		expect(lookup.status).toBe(200);
		expect(await lookup.json()).toEqual({
			[artifactId]: {
				size: body.byteLength,
				tag: "test#unit",
				taskDurationMs: 42,
			},
			[missingArtifactId]: null,
		});
	});

	it("bounds artifact lookup fanout", async ({ expect }) => {
		const response = await fetchAuthed(`/v8/artifacts?teamId=${TEAM_ID}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ hashes: Array.from({ length: 1001 }, (_, index) => `hash-${index}`) }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "bad_request",
				message: "Artifact lookup supports at most 1000 hashes",
			},
		});
	});

	it("accepts Turbo analytics events", async ({ expect }) => {
		const response = await fetchAuthed(`/v8/artifacts/events?teamId=${TEAM_ID}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify([{ event: "HIT", hash: randomArtifactId(), source: "REMOTE", duration: 1 }]),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ accepted: true });
	});

	it("accepts event variants with and without session ids", async ({ expect }) => {
		const response = await fetchAuthed(`/v8/artifacts/events?teamId=${TEAM_ID}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify([
				{ event: "HIT", hash: randomArtifactId(), source: "REMOTE", duration: 1, sessionId: crypto.randomUUID() },
				{ event: "MISS", hash: randomArtifactId(), source: "LOCAL", duration: 0 },
			]),
		});

		expect(response.status).toBe(200);
	});

	it("emits analytics datapoints without blocking requests", async ({ expect }) => {
		const points: AnalyticsPoint[] = [];
		const analytics = { writeDataPoint: (point: AnalyticsPoint) => points.push(point) } as AnalyticsEngineDataset;
		const env = { ANALYTICS: analytics, ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN } satisfies Env;
		const artifactId = randomArtifactId();
		const requests = [
			new Request(`${BASE_URL}/v8/artifacts/status`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { method: "OPTIONS" }),
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, {
				method: "PUT",
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				body: new Uint8Array([1]),
			}),
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}/v8/artifacts/${artifactId}?teamId=${TEAM_ID}`, { method: "HEAD", headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}/v8/artifacts/events?teamId=${TEAM_ID}`, {
				method: "POST",
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
				body: JSON.stringify([{ event: "HIT", source: "REMOTE", hash: artifactId, duration: 1 }]),
			}),
		];

		for (const request of requests) {
			const ctx = createExecutionContext();
			const response = await handleRequest(request, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBeLessThan(500);
		}

		expect(points.map((point) => point.blobs?.[0])).toEqual(["status", "preflight", "get_miss", "put", "get_hit", "head_hit", "events"]);
		expect(points.every((point) => point.indexes?.[0] !== undefined)).toBe(true);
	});
});

function fetchAuthed(path: string, init: RequestInit = {}, token = TOKEN): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	return SELF.fetch(`${BASE_URL}${path}`, { ...init, headers });
}

function scopedEnv(): Env {
	return {
		ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS,
		TURBO_TOKEN_SCOPES: JSON.stringify([
			{ id: "ci-read", scopes: ["read"], teams: [TEAM_ID], token: SCOPED_READ_TOKEN },
			{ id: "ci-write", scopes: ["read", "write"], teams: [TEAM_ID], token: SCOPED_WRITE_TOKEN },
		]),
	};
}

function randomArtifactId(): string {
	return crypto.randomUUID().replaceAll("-", "");
}

type TestJsonWebKey = JsonWebKey & { alg?: string; kid?: string; use?: string };

interface TokenAdminRow {
	expires_at: string | null;
	id: string;
	revoked_at: string | null;
	scopes: string;
	teams: string;
	token_hash: string;
}

interface RouteCleanupObject {
	key: string;
	uploaded: Date;
}

class RouteCleanupBucket {
	readonly deleted: string[] = [];

	constructor(private readonly objects: RouteCleanupObject[]) {}

	async list(options: R2ListOptions): Promise<R2Objects> {
		const filtered = this.objects.filter((object) => object.key.startsWith(options.prefix ?? ""));
		return {
			delimitedPrefixes: [],
			objects: filtered.map((object) => ({
				checksums: {} as R2Checksums,
				etag: object.key,
				httpEtag: `"${object.key}"`,
				key: object.key,
				size: 1,
				storageClass: "Standard",
				uploaded: object.uploaded,
				version: object.key,
				writeHttpMetadata() {},
			})) as unknown as R2Object[],
			truncated: false,
		};
	}

	async delete(keys: string | string[]): Promise<void> {
		this.deleted.push(...(Array.isArray(keys) ? keys : [keys]));
	}
}

class TokenAdminDb {
	readonly rows = new Map<string, TokenAdminRow>();

	prepare(query: string): D1PreparedStatement {
		return {
			all: async () => ({ results: [...this.rows.values()].sort((left, right) => left.id.localeCompare(right.id)) }),
			bind: (...values: unknown[]) => ({
				all: async () => ({ results: [...this.rows.values()].sort((left, right) => left.id.localeCompare(right.id)) }),
				first: async () => null,
				run: async () => {
					if (query.startsWith("insert")) {
						const [id, tokenHash, teams, scopes, expiresAt] = values as [string, string, string, string, string | null];
						this.rows.set(id, { expires_at: expiresAt, id, revoked_at: null, scopes, teams, token_hash: tokenHash });
					}

					if (query.startsWith("update")) {
						const [revokedAt, id] = values as [string, string];
						const row = this.rows.get(id);
						if (row !== undefined && row.revoked_at === null) {
							row.revoked_at = revokedAt;
						}
					}

					return { success: true };
				},
			}),
		} as unknown as D1PreparedStatement;
	}
}

async function accessFixture(input: { audience?: string; issuer?: string } = {}): Promise<{ audience: string; issuer: string; publicJwk: TestJsonWebKey; token: string }> {
	const audience = input.audience ?? "expected-audience";
	const issuer = input.issuer ?? "https://turboflare.cloudflareaccess.com";
	const keyPair = await crypto.subtle.generateKey(
		{ hash: "SHA-256", modulusLength: 2048, name: "RSASSA-PKCS1-v1_5", publicExponent: new Uint8Array([1, 0, 1]) },
		true,
		["sign", "verify"]
	);
	const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as TestJsonWebKey;
	publicJwk.alg = "RS256";
	publicJwk.kid = "test-key";
	publicJwk.use = "sig";

	return {
		audience,
		issuer,
		publicJwk,
		token: await signJwt(keyPair.privateKey, {
			aud: [audience],
			exp: Math.floor(Date.now() / 1000) + 60,
			iat: Math.floor(Date.now() / 1000),
			iss: issuer,
			sub: "user@example.com",
			type: "app",
		}),
	};
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>): Promise<string> {
	const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
	const encodedPayload = base64Url(JSON.stringify(payload));
	const signingInput = `${encodedHeader}.${encodedPayload}`;
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signingInput));
	return `${signingInput}.${base64Url(signature)}`;
}

function base64Url(value: string | ArrayBuffer): string {
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function daysAgo(days: number): Date {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
