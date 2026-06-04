import { env as workerEnv } from "cloudflare:workers";
import { SELF, createExecutionContext, reset } from "cloudflare:test";
import { afterEach, describe, it } from "vitest";

import { CacheStatus } from "@turboflare/protocol";

import { handleRequest, type Env } from "../src";

const BASE_URL = "https://cache.turboflare.test";
const TOKEN = "test-token";
const ROTATED_TOKEN = "rotated-token";
const TEAM_ID = "team_turboflare";
const OTHER_TEAM_ID = "team_other";
const SCOPED_READ_TOKEN = "scoped-read-token";
const SCOPED_WRITE_TOKEN = "scoped-write-token";

afterEach(async () => {
	await reset();
});

describe("cache worker", () => {
	it("serves a public health check", async ({ expect }) => {
		const response = await SELF.fetch(`${BASE_URL}/management/health`);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
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
