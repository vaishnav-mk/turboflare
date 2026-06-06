import { env as workerEnv } from "cloudflare:workers";
import { SELF, createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, it } from "vitest";

import { ARTIFACTS_PATH, ARTIFACT_EVENTS_PATH, ARTIFACT_STATUS_PATH, CacheStatus } from "@turboflare/protocol";

import { handleRequest, type Env } from "../src";
import { hashToken } from "../src/auth/d1";
import { artifactCache, cacheRequest } from "../src/storage/cache-api";
import { daysAgo } from "./helpers/time";

const BASE_URL = "https://cache.turboflare.test";
const TOKEN = "test-token";
const ROTATED_TOKEN = "rotated-token";
const TEAM_ID = "team_turboflare";
const OTHER_TEAM_ID = "team_other";
const SCOPED_READ_TOKEN = "scoped-read-token";
const SCOPED_WRITE_TOKEN = "scoped-write-token";
const INTERNAL_ADMIN_TOKEN = "internal-admin-token";

interface AnalyticsPoint {
	blobs?: string[];
	doubles?: number[];
	indexes?: string[];
}

interface InternalAdminFixture {
	env: Env;
	token: string;
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
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, INTERNAL_ADMIN_TOKEN, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);
		expect(bearerOnly.status).toBe(403);
		expect(await bearerOnly.json()).toEqual({
			error: { code: "forbidden", message: "Invalid internal admin token" },
		});
	});

	it("requires internal admin token for internal routes", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}/internal/health`, { headers: { Authorization: `Bearer ${INTERNAL_ADMIN_TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, INTERNAL_ADMIN_TOKEN, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(200);
	});

	it("fails closed when internal admin token is not configured", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}/internal/health`),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: { code: "unavailable", message: "Internal admin token is not configured" },
		});
	});

	it("reports and purges internal team artifacts", async ({ expect }) => {
		const admin = internalAdmin({ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN } satisfies Env);
		await admin.env.ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/one`, new Uint8Array([1, 2]));
		await admin.env.ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/two`, new Uint8Array([3]));
		await admin.env.ARTIFACTS.put(`v1/team/${TEAM_ID}/branch/pr-1/artifact/branch`, new Uint8Array([5]));
		await admin.env.ARTIFACTS.put(`v1/team/${OTHER_TEAM_ID}/artifact/three`, new Uint8Array([4]));

		const stats = await handleRequest(internalRequest(`/internal/teams/${TEAM_ID}/stats`, admin), admin.env, createExecutionContext());
		expect(stats.status).toBe(200);
		expect(await stats.json()).toEqual({ bytes: 4, objects: 3, team: TEAM_ID });

		const purge = await handleRequest(internalRequest(`/internal/teams/${TEAM_ID}/purge-all`, admin, { method: "POST" }), admin.env, createExecutionContext());
		expect(purge.status).toBe(200);
		expect(await purge.json()).toEqual({ deleted: 3, team: TEAM_ID });

		expect(await admin.env.ARTIFACTS.head(`v1/team/${TEAM_ID}/artifact/one`)).toBeNull();
		expect(await admin.env.ARTIFACTS.head(`v1/team/${TEAM_ID}/branch/pr-1/artifact/branch`)).toBeNull();
		expect(await admin.env.ARTIFACTS.head(`v1/team/${OTHER_TEAM_ID}/artifact/three`)).not.toBeNull();
	});

	it("creates lists and revokes internal tokens", async ({ expect }) => {
		const tokenDb = new TokenAdminDb();
		const admin = internalAdmin({ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TOKEN_DB: tokenDb as unknown as D1Database } satisfies Env);
		const expiresAt = "2027-01-01T00:00:00.000Z";

		const create = await handleRequest(
			internalRequest("/internal/tokens", admin, {
				body: JSON.stringify({ expiresAt, id: "ci-token", scopes: ["read", "write"], teams: [TEAM_ID], token: "raw-token" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
			admin.env,
			createExecutionContext()
		);

		expect(create.status).toBe(201);
		expect(await create.json()).toEqual({
			token: { expiresAt, id: "ci-token", revokedAt: null, scopes: ["read", "write"], teams: [TEAM_ID], token: "raw-token" },
		});
		expect(tokenDb.rows.get("ci-token")?.token_hash).toBe(await hashToken("raw-token"));
		expect(tokenDb.audit.map((row) => [row.action, row.token_id])).toEqual([["create", "ci-token"]]);

		const list = await handleRequest(internalRequest("/internal/tokens", admin), admin.env, createExecutionContext());
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({
			tokens: [{ expiresAt, id: "ci-token", revokedAt: null, scopes: ["read", "write"], teams: [TEAM_ID] }],
		});

		const revoke = await handleRequest(internalRequest("/internal/tokens/ci-token/revoke", admin, { method: "POST" }), admin.env, createExecutionContext());
		expect(revoke.status).toBe(200);
		expect(await revoke.json()).toEqual({ revoked: { id: "ci-token", revokedAt: expect.any(String) } });
		expect(tokenDb.rows.get("ci-token")?.revoked_at).toEqual(expect.any(String));
		expect(tokenDb.audit.map((row) => [row.action, row.token_id])).toEqual([
			["create", "ci-token"],
			["revoke", "ci-token"],
		]);
	});

	it("purges expired artifacts through the internal route", async ({ expect }) => {
		const bucket = new RouteCleanupBucket([
			{ key: `v1/team/${TEAM_ID}/artifact/old`, uploaded: daysAgo(40) },
			{ key: `v1/team/${TEAM_ID}/artifact/new`, uploaded: daysAgo(1) },
			{ key: `legacy/team/${TEAM_ID}/artifact/old`, uploaded: daysAgo(40) },
		]);
		const admin = internalAdmin({ ARTIFACTS: bucket as unknown as R2Bucket, RETENTION_DAYS: "30" } satisfies Env);

		const response = await handleRequest(internalRequest("/internal/artifacts/purge-expired", admin, { method: "POST" }), admin.env, createExecutionContext());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ deleted: 1, scanned: 2 });
		expect(bucket.deleted).toEqual([`v1/team/${TEAM_ID}/artifact/old`]);
	});

	it("requires token database for internal token routes", async ({ expect }) => {
		const admin = internalAdmin({ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS } satisfies Env);
		const response = await handleRequest(
			internalRequest("/internal/tokens", admin),
			admin.env,
			createExecutionContext()
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: { code: "unavailable", message: "Token database is not configured" },
		});
	});

	it("rejects unauthenticated Turbo requests", async ({ expect }) => {
		const response = await SELF.fetch(`${BASE_URL}${ARTIFACT_STATUS_PATH}`);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: {
				code: "unauthorized",
				message: "Missing or invalid bearer token",
			},
		});
	});

	it("serves Turbo user and team compatibility metadata", async ({ expect }) => {
		const user = await fetchAuthed("/v2/user");
		expect(user.status).toBe(200);
		expect(await user.json()).toEqual({
			user: {
				email: "static-0@turboflare.local",
				id: "static-0",
				name: "Turboflare User",
				username: "static-0",
			},
		});

		const teams = await handleRequest(
			new Request(`${BASE_URL}/v2/teams`, { headers: { Authorization: `Bearer ${SCOPED_WRITE_TOKEN}` } }),
			scopedEnv(),
			createExecutionContext()
		);
		expect(teams.status).toBe(200);
		expect(await teams.json()).toEqual({
			teams: [
				{
					created: "1970-01-01T00:00:00.000Z",
					createdAt: 0,
					id: TEAM_ID,
					membership: { role: "OWNER" },
					name: "turboflare",
					slug: "turboflare",
				},
			],
		});

		const team = await handleRequest(
			new Request(`${BASE_URL}/v2/teams/${TEAM_ID}`, { headers: { Authorization: `Bearer ${SCOPED_WRITE_TOKEN}` } }),
			scopedEnv(),
			createExecutionContext()
		);
		expect(team.status).toBe(200);
		expect(await team.json()).toMatchObject({ id: TEAM_ID, slug: "turboflare" });
	});

	it("rejects compatibility metadata for unauthorized teams", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}/v2/teams/${OTHER_TEAM_ID}`, { headers: { Authorization: `Bearer ${SCOPED_WRITE_TOKEN}` } }),
			scopedEnv(),
			createExecutionContext()
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: { code: "forbidden", message: "Token cannot access this team" },
		});
	});

	it("reports enabled cache status", async ({ expect }) => {
		const response = await fetchAuthed(ARTIFACT_STATUS_PATH);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "enabled" });
	});

	it("reports configured cache status variants", async ({ expect }) => {
		for (const status of Object.values(CacheStatus)) {
			const response = await handleRequest(
				new Request(`${BASE_URL}${ARTIFACT_STATUS_PATH}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
				{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_STATUS: status, TURBO_TOKEN: TOKEN },
				createExecutionContext()
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status });
		}
	});

	it("rejects invalid bearer tokens consistently", async ({ expect }) => {
		const response = await fetchAuthed(ARTIFACT_STATUS_PATH, {}, "bad-token");

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: {
				code: "unauthorized",
				message: "Missing or invalid bearer token",
			},
		});
	});

	it("accepts comma-separated bearer token allowlists", async ({ expect }) => {
		const response = await fetchAuthed(ARTIFACT_STATUS_PATH, {}, ROTATED_TOKEN);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "enabled" });
	});

	it("allows Turbo preflight headers", async ({ expect }) => {
		const response = await SELF.fetch(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}`, {
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

	it("allows Turbo event preflight headers", async ({ expect }) => {
		const response = await SELF.fetch(`${BASE_URL}${ARTIFACT_EVENTS_PATH}`, {
			method: "OPTIONS",
			headers: {
				"Access-Control-Request-Headers": "Authorization, Content-Type",
				"Access-Control-Request-Method": "POST",
			},
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-methods")).toContain("POST");
		expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, RATE_LIMITER: rateLimiter as unknown as RateLimit, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(429);
		expect(key).toBe(`team:${TEAM_ID}:token:static-0`);
		expect(await response.json()).toEqual({
			error: { code: "rate_limited", message: "Rate limit exceeded" },
		});
	});

	it("rejects artifacts above the configured upload quota", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				body: new Uint8Array([1, 2]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Length": "2", "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, MAX_ARTIFACT_BYTES: "1", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: { code: "artifact_too_large", message: "Artifact upload exceeds configured size limit" },
		});
	});

	it("streams artifact uploads and downloads through R2", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const body = new Uint8Array([1, 2, 3, 4, 5]);

		const put = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
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

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(get.headers.get("content-type")).toBe("application/octet-stream");
		expect(get.headers.get("content-length")).toBe(body.byteLength.toString());
		expect(get.headers.get("x-artifact-duration")).toBe("1234");
		expect(get.headers.get("x-artifact-tag")).toBe("build#app");
		expect(get.headers.get("x-artifact-sha")).toBe("sha-value");
		expect(get.headers.get("x-artifact-dirty-hash")).toBe("dirty-hash");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);

		const head = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
			method: "HEAD",
		});
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe(body.byteLength.toString());
		expect(head.headers.get("x-artifact-duration")).toBe("1234");
	});

	it("requires signed artifact metadata when signature policy is require", async ({ expect }) => {
		const unsigned = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, SIGNATURE_POLICY: "require", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);
		expect(unsigned.status).toBe(400);
		expect(await unsigned.json()).toEqual({ error: { code: "signature_required", message: "Signed artifact metadata is required" } });

		const signed = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream", "x-artifact-sha": "sha-value" },
				method: "PUT",
			}),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, SIGNATURE_POLICY: "require", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);
		expect(signed.status).toBe(200);
	});

	it("isolates branch artifacts when branch cache policy is isolated", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const env = { ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, BRANCH_CACHE_POLICY: "isolated", TURBO_TOKEN: TOKEN } satisfies Env;

		const put = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}&branch=feature/a`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			env,
			createExecutionContext()
		);
		expect(put.status).toBe(200);
		expect(await env.ARTIFACTS.head(`v1/team/${TEAM_ID}/branch/feature%2Fa/artifact/${artifactId}`)).not.toBeNull();
		expect(await env.ARTIFACTS.head(`v1/team/${TEAM_ID}/artifact/${artifactId}`)).toBeNull();
	});

	it("falls back to main artifacts for pull request branch reads", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const env = { ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, BRANCH_CACHE_POLICY: "main-write-pr-read", TURBO_TOKEN: TOKEN } satisfies Env;
		await env.ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/${artifactId}`, new Uint8Array([9]), { httpMetadata: { contentType: "application/octet-stream" } });

		const get = await handleRequest(new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}&branch=pr-1`, { headers: { Authorization: `Bearer ${TOKEN}` } }), env, createExecutionContext());

		expect(get.status).toBe(200);
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([9]));
	});

	it("rejects pull request writes in read-only branch policy", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}&branch=pr-1`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, BRANCH_CACHE_POLICY: "read-only-pr", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(403);
	});

	it("extracts branch names from Turbo team slugs", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const env = { ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, BRANCH_CACHE_POLICY: "isolated", TURBO_TOKEN: TOKEN } satisfies Env;

		const put = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?slug=${TEAM_ID}@feature-b`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			env,
			createExecutionContext()
		);

		expect(put.status).toBe(200);
		expect(await env.ARTIFACTS.head(`v1/team/${TEAM_ID}/branch/feature-b/artifact/${artifactId}`)).not.toBeNull();
	});

	it("supports the optional KV artifact store", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const body = new Uint8Array([4, 2, 0]);
		const kv = new MemoryKV();
		const env = { ARTIFACT_STORE: "kv", ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, ARTIFACTS_KV: kv as unknown as KVNamespace, TURBO_TOKEN: TOKEN } satisfies Env;

		const put = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
				body,
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Length": body.byteLength.toString(), "Content-Type": "application/octet-stream", "x-artifact-duration": "6", "x-artifact-tag": "kv" },
				method: "PUT",
			}),
			env,
			createExecutionContext()
		);
		expect(put.status).toBe(200);

		const head = await handleRequest(new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` }, method: "HEAD" }), env, createExecutionContext());
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe(body.byteLength.toString());
		expect(head.headers.get("x-artifact-duration")).toBe("6");

		const get = await handleRequest(new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }), env, createExecutionContext());
		expect(get.status).toBe(200);
		expect(get.headers.get("x-artifact-tag")).toBe("kv");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);

		const lookup = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}?teamId=${TEAM_ID}`, { body: JSON.stringify({ hashes: [artifactId, "missing"] }), headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, method: "POST" }),
			env,
			createExecutionContext()
		);
		expect(await lookup.json()).toEqual({
			[artifactId]: { size: body.byteLength, tag: "kv", taskDurationMs: 6 },
			missing: null,
		});
	});

	it("requires explicit KV binding for KV artifact store", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACT_STORE: "kv", ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: { code: "unavailable", message: "KV artifact store is not configured" } });
	});

	it("caps KV artifact uploads", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Length": `${25 * 1024 * 1024 + 1}`, "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			{ ARTIFACT_STORE: "kv", ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, ARTIFACTS_KV: new MemoryKV() as unknown as KVNamespace, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: { code: "artifact_too_large", message: "Artifact upload exceeds configured KV size limit" } });
	});

	it("reports and purges KV team artifacts", async ({ expect }) => {
		const kv = new MemoryKV();
		const admin = internalAdmin({ ARTIFACT_STORE: "kv", ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, ARTIFACTS_KV: kv as unknown as KVNamespace, TURBO_TOKEN: TOKEN } satisfies Env);
		await kv.put(`v1/team/${TEAM_ID}/artifact/one`, new Uint8Array([1, 2]), { metadata: kvMetadata({ duration: "1" }, 2) });
		await kv.put(`v1/team/${OTHER_TEAM_ID}/artifact/two`, new Uint8Array([3]), { metadata: kvMetadata({ duration: "1" }, 1) });

		const stats = await handleRequest(internalRequest(`/internal/teams/${TEAM_ID}/stats`, admin), admin.env, createExecutionContext());
		expect(await stats.json()).toEqual({ bytes: 2, objects: 1, team: TEAM_ID });

		const purge = await handleRequest(internalRequest(`/internal/teams/${TEAM_ID}/purge-all`, admin, { method: "POST" }), admin.env, createExecutionContext());
		expect(await purge.json()).toEqual({ deleted: 1, team: TEAM_ID });
		expect(kv.entries.has(`v1/team/${TEAM_ID}/artifact/one`)).toBe(false);
		expect(kv.entries.has(`v1/team/${OTHER_TEAM_ID}/artifact/two`)).toBe(true);
	});

	it("supports no-team single-tenant artifact requests", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const body = new Uint8Array([5, 5, 5]);

		const put = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}`, {
			body,
			headers: { "Content-Type": "application/octet-stream" },
			method: "PUT",
		});
		expect(put.status).toBe(200);

		const stored = await (workerEnv as unknown as Env).ARTIFACTS.head(`v1/team/global/artifact/${artifactId}`);
		expect(stored).not.toBeNull();

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}`);
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
	});

	it("round-trips large artifacts without buffering in route code", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const body = new Uint8Array(1024 * 1024);
		body.fill(7);

		const put = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
			body,
			headers: { "Content-Length": body.byteLength.toString(), "Content-Type": "application/octet-stream" },
			method: "PUT",
		});
		expect(put.status).toBe(200);

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.headers.get("content-length")).toBe(body.byteLength.toString());
		expect((await get.arrayBuffer()).byteLength).toBe(body.byteLength);
	});

	it("uses R2 head without reading object bodies", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const bucket = new HeadOnlyBucket(`v1/team/${TEAM_ID}/artifact/${artifactId}`);
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` }, method: "HEAD" }),
			{ ARTIFACTS: bucket as unknown as R2Bucket, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(200);
		expect(bucket.headCalls).toBe(1);
		expect(bucket.getCalls).toBe(0);
	});

	it("indexes artifact metadata when an index database is bound", async ({ expect }) => {
		const artifactId = randomArtifactId();
		const index = new ArtifactIndexDb();
		const ctx = createExecutionContext();
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
				body: new Uint8Array([1, 2, 3]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream", "x-artifact-duration": "12", "x-artifact-tag": "build#app" },
				method: "PUT",
			}),
			{ ARTIFACT_INDEX: index as unknown as D1Database, ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN },
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(index.rows.get(`v1/team/${TEAM_ID}/artifact/${artifactId}`)).toMatchObject({
			artifact_id: artifactId,
			duration_ms: 12,
			size: 3,
			tag: "build#app",
			team: TEAM_ID,
			token_id: "static-0",
		});
	});

	it("does not fail uploads when artifact indexing fails", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			{ ARTIFACT_INDEX: new ThrowingD1() as unknown as D1Database, ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(response.status).toBe(200);
	});

	it("accepts incremental artifact ids", async ({ expect }) => {
		const artifactId = `incremental-${"a".repeat(64)}`;
		const body = new Uint8Array([9, 9, 9]);

		const put = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
				"x-artifact-duration": "0",
			},
			body,
		});

		expect(put.status).toBe(200);

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);

		const lookup = await fetchAuthed(`${ARTIFACTS_PATH}?teamId=${TEAM_ID}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ hashes: [artifactId] }),
		});

		expect(await lookup.json()).toEqual({
			[artifactId]: { size: body.byteLength, taskDurationMs: 0 },
		});
	});

	it("rejects unsupported upload content types", async ({ expect }) => {
		const response = await fetchAuthed(`${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
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

		const first = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream", "x-artifact-duration": "1", "x-artifact-tag": "first" },
			body: new Uint8Array([1]),
		});
		const second = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream", "x-artifact-duration": "2", "x-artifact-tag": "second" },
			body: new Uint8Array([2, 2]),
		});

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.headers.get("x-artifact-duration")).toBe("2");
		expect(get.headers.get("x-artifact-tag")).toBe("second");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([2, 2]));
	});

	it("handles R2 objects without custom metadata", async ({ expect }) => {
		const artifactId = randomArtifactId();
		await (workerEnv as unknown as Env).ARTIFACTS.put(`v1/team/${TEAM_ID}/artifact/${artifactId}`, new Uint8Array([1, 2]), {
			httpMetadata: { contentType: "application/octet-stream" },
		});

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(get.headers.get("x-artifact-duration")).toBe("0");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
	});

	it("rejects oversized object keys", async ({ expect }) => {
		const artifactId = "x".repeat(1_200);
		const response = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
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

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`);
		expect(get.status).toBe(404);
		expect(await get.text()).toBe("");

		const head = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { method: "HEAD" });
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			fillCtx
		);
		await waitOnExecutionContext(fillCtx);
		expect(first.status).toBe(200);

		await (workerEnv as unknown as Env).ARTIFACTS.delete(key);

		const cached = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			firstCtx
		);
		await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${OTHER_TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			secondCtx
		);
		await waitOnExecutionContext(firstCtx);
		await waitOnExecutionContext(secondCtx);

		await (workerEnv as unknown as Env).ARTIFACTS.delete(`v1/team/${TEAM_ID}/artifact/${artifactId}`);
		await (workerEnv as unknown as Env).ARTIFACTS.delete(`v1/team/${OTHER_TEAM_ID}/artifact/${artifactId}`);

		const first = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);
		const second = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${OTHER_TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_MAX_BYTES: "1", CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(first.status).toBe(200);
		expect(await artifactCache().match(cacheRequest(key))).toBeUndefined();

		await (workerEnv as unknown as Env).ARTIFACTS.delete(key);

		const miss = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, CACHE_API_MAX_BYTES: "1", CACHE_API_READS: "true", TURBO_TOKEN: TOKEN },
			createExecutionContext()
		);

		expect(miss.status).toBe(404);
	});

	it("rejects invalid artifact duration metadata", async ({ expect }) => {
		const response = await fetchAuthed(`${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, READ_ONLY: "true", TURBO_TOKEN: TOKEN },
			ctx
		);

		expect(get.status).toBe(200);
	});

	it("rejects scoped tokens without write scope", async ({ expect }) => {
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${OTHER_TEAM_ID}`, {
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
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
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

		const put = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?team=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
			},
			body,
		});
		expect(put.status).toBe(200);

		const get = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?team=${TEAM_ID}`);
		expect(get.status).toBe(200);
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
	});

	it("scopes slug and teamId to separate R2 keys", async ({ expect }) => {
		const artifactId = randomArtifactId();
		await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?slug=docs`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream" },
			body: new Uint8Array([1]),
		});
		await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=team_docs`, {
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
		const response = await fetchAuthed(`${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
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

		const put = await fetchAuthed(`${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
				"x-artifact-duration": "42",
				"x-artifact-tag": "test#unit",
			},
			body,
		});
		expect(put.status).toBe(200);

		const lookup = await fetchAuthed(`${ARTIFACTS_PATH}?teamId=${TEAM_ID}`, {
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
		const response = await fetchAuthed(`${ARTIFACTS_PATH}?teamId=${TEAM_ID}`, {
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
		const response = await fetchAuthed(`${ARTIFACT_EVENTS_PATH}?teamId=${TEAM_ID}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify([{ event: "HIT", hash: randomArtifactId(), source: "REMOTE", duration: 1 }]),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ accepted: true });
	});

	it("rejects malformed Turbo analytics events", async ({ expect }) => {
		const response = await fetchAuthed(`${ARTIFACT_EVENTS_PATH}?teamId=${TEAM_ID}`, {
			body: JSON.stringify({ event: "HIT" }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: "bad_request", message: "Events request body must be an array of Turbo cache events" },
		});
	});

	it("accepts event variants with and without session ids", async ({ expect }) => {
		const response = await fetchAuthed(`${ARTIFACT_EVENTS_PATH}?teamId=${TEAM_ID}`, {
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
			new Request(`${BASE_URL}${ARTIFACT_STATUS_PATH}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { method: "OPTIONS" }),
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, {
				method: "PUT",
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				body: new Uint8Array([1]),
			}),
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${artifactId}?teamId=${TEAM_ID}`, { method: "HEAD", headers: { Authorization: `Bearer ${TOKEN}` } }),
			new Request(`${BASE_URL}${ARTIFACT_EVENTS_PATH}?teamId=${TEAM_ID}`, {
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
		expect(points.find((point) => point.blobs?.[0] === "put")?.blobs?.[3]).toBe(artifactId.slice(0, 16));
		expect(points.every((point) => point.indexes?.[0] !== undefined)).toBe(true);
	});

	it("emits signature monitoring metrics for unsigned uploads", async ({ expect }) => {
		const points: AnalyticsPoint[] = [];
		const analytics = { writeDataPoint: (point: AnalyticsPoint) => points.push(point) } as AnalyticsEngineDataset;
		const ctx = createExecutionContext();

		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACTS_PATH}/${randomArtifactId()}?teamId=${TEAM_ID}`, {
				body: new Uint8Array([1]),
				headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
				method: "PUT",
			}),
			{ ANALYTICS: analytics, ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, SIGNATURE_POLICY: "monitor", TURBO_TOKEN: TOKEN },
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(points.map((point) => point.blobs?.[0])).toContain("signature_missing");
	});

	it("ignores analytics write failures", async ({ expect }) => {
		const analytics = { writeDataPoint: () => { throw new Error("analytics down"); } } as unknown as AnalyticsEngineDataset;
		const ctx = createExecutionContext();
		const response = await handleRequest(
			new Request(`${BASE_URL}${ARTIFACT_STATUS_PATH}`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
			{ ANALYTICS: analytics, ARTIFACTS: (workerEnv as unknown as Env).ARTIFACTS, TURBO_TOKEN: TOKEN },
			ctx
		);

		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
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

interface TokenAdminRow {
	expires_at: string | null;
	id: string;
	revoked_at: string | null;
	scopes: string;
	teams: string;
	token_hash: string;
}

interface TokenAuditRow {
	action: string;
	created_at: string;
	id: string;
	token_id: string;
}

interface ArtifactIndexRow {
	artifact_id: string;
	created_at: string;
	dirty_hash: string | null;
	duration_ms: number;
	object_key: string;
	sha: string | null;
	size: number;
	tag: string | null;
	team: string;
	token_id: string;
	updated_at: string;
}

class ArtifactIndexDb {
	readonly rows = new Map<string, ArtifactIndexRow>();

	prepare(query: string): D1PreparedStatement {
		return {
			bind: (...values: unknown[]) => ({
				run: async () => {
					if (query.startsWith("insert")) {
						const [objectKey, team, artifactId, size, durationMs, tag, sha, dirtyHash, tokenId, createdAt, updatedAt] = values as [
							string,
							string,
							string,
							number,
							number,
							string | null,
							string | null,
							string | null,
							string,
							string,
							string,
						];
						this.rows.set(objectKey, { artifact_id: artifactId, created_at: createdAt, dirty_hash: dirtyHash, duration_ms: durationMs, object_key: objectKey, sha, size, tag, team, token_id: tokenId, updated_at: updatedAt });
					}

					if (query.startsWith("delete")) {
						this.rows.delete(values[0] as string);
					}

					return { success: true };
				},
			}),
		} as unknown as D1PreparedStatement;
	}
}

class ThrowingD1 {
	prepare(): D1PreparedStatement {
		return {
			bind: () => ({
				run: async () => {
					throw new Error("d1 down");
				},
			}),
		} as unknown as D1PreparedStatement;
	}
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

class HeadOnlyBucket {
	getCalls = 0;
	headCalls = 0;

	constructor(private readonly key: string) {}

	async get(): Promise<R2ObjectBody | null> {
		this.getCalls += 1;
		throw new Error("HEAD must not call get");
	}

	async head(key: string): Promise<R2Object | null> {
		this.headCalls += 1;
		if (key !== this.key) {
			return null;
		}

		return {
			checksums: {} as R2Checksums,
			customMetadata: { duration: "4" },
			etag: key,
			httpEtag: `"${key}"`,
			httpMetadata: { contentType: "application/octet-stream" },
			key,
			size: 4,
			storageClass: "Standard",
			uploaded: new Date(0),
			version: key,
			writeHttpMetadata() {},
		} as unknown as R2Object;
	}
}

interface MemoryKVEntry {
	body: Uint8Array;
	metadata?: unknown;
}

class MemoryKV {
	readonly entries = new Map<string, MemoryKVEntry>();

	async delete(key: string): Promise<void> {
		this.entries.delete(key);
	}

	async getWithMetadata<Metadata>(key: string): Promise<{ metadata: Metadata | null; value: ReadableStream | null }> {
		const entry = this.entries.get(key);
		const body = entry?.body.buffer.slice(entry.body.byteOffset, entry.body.byteOffset + entry.body.byteLength) as ArrayBuffer | undefined;
		return entry === undefined || body === undefined ? { metadata: null, value: null } : { metadata: (entry.metadata ?? null) as Metadata | null, value: new Response(body).body };
	}

	async list<Metadata>(options: KVNamespaceListOptions): Promise<KVNamespaceListResult<Metadata, string>> {
		const keys = [...this.entries.entries()]
			.filter(([key]) => key.startsWith(options.prefix ?? ""))
			.map(([name, entry]) => ({ name, metadata: entry.metadata as Metadata }));

		return { cacheStatus: null, cursor: "", keys, list_complete: true } as KVNamespaceListResult<Metadata, string>;
	}

	async put(key: string, value: ArrayBuffer | ArrayBufferView, options?: KVNamespacePutOptions): Promise<void> {
		const body = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
		this.entries.set(key, { body, metadata: options?.metadata });
	}
}

function kvMetadata(metadata: Record<string, string>, size: number): Record<string, string> {
	return { ...metadata, httpEtag: `"${crypto.randomUUID()}"`, size: size.toString(), uploaded: new Date().toISOString() };
}

class TokenAdminDb {
	readonly audit: TokenAuditRow[] = [];
	readonly rows = new Map<string, TokenAdminRow>();

	prepare(query: string): D1PreparedStatement {
		return {
			all: async () => ({ results: [...this.rows.values()].sort((left, right) => left.id.localeCompare(right.id)) }),
			bind: (...values: unknown[]) => ({
				all: async () => ({ results: [...this.rows.values()].sort((left, right) => left.id.localeCompare(right.id)) }),
				first: async () => null,
					run: async () => {
					if (query.startsWith("insert")) {
						if (query.includes("token_audit")) {
							const [id, tokenId, action, createdAt] = values as [string, string, string, string];
							this.audit.push({ action, created_at: createdAt, id, token_id: tokenId });
						} else {
							const [id, tokenHash, teams, scopes, expiresAt] = values as [string, string, string, string, string | null];
							this.rows.set(id, { expires_at: expiresAt, id, revoked_at: null, scopes, teams, token_hash: tokenHash });
						}
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

function internalAdmin(env: Env): InternalAdminFixture {
	return { env: { ...env, INTERNAL_ADMIN_TOKEN }, token: INTERNAL_ADMIN_TOKEN };
}

function internalRequest(path: string, admin: InternalAdminFixture, init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${admin.token}`);
	return new Request(`${BASE_URL}${path}`, { ...init, headers });
}
