import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "vitest";

import { handleRequest, type Env } from "../src";

interface TestServer {
	close: () => Promise<void>;
	url: string;
}

interface StoredObject {
	body: Uint8Array<ArrayBuffer>;
	customMetadata?: Record<string, string>;
	etag: string;
	httpMetadata?: R2HTTPMetadata;
	key: string;
	uploaded: Date;
}

interface TurboFixture {
	counterPath: string;
	directory: string;
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const TURBO_BIN = join(REPO_ROOT, "node_modules", ".bin", "turbo");
const TURBO_TOKEN = "fixture-token";
const TURBO_TEAM = "team_fixture";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
});

describe("real turbo fixture", () => {
	it("restores a remote cache hit on the second run", async ({ expect }) => {
		const artifacts = new MemoryR2Bucket();
		const server = await startWorkerServer({ ARTIFACTS: artifacts as unknown as R2Bucket, TURBO_TOKEN });
		cleanupTasks.push(server.close);

		const fixture = await createTurboFixture();
		cleanupTasks.push(() => rm(fixture.directory, { force: true, recursive: true }));
		cleanupTasks.push(() => rm(fixture.counterPath, { force: true }));

		const first = await runTurbo(fixture.directory, server.url);
		expect(first.stdout).toMatch(/cache miss/i);
		const firstHash = cacheHash(first.stdout);
		expect(artifacts.objects.size).toBeGreaterThan(0);
		expect(await readFile(fixture.counterPath, "utf8")).toBe("1");

		await rm(join(fixture.directory, ".turbo"), { force: true, recursive: true });
		await rm(join(fixture.directory, "dist"), { force: true, recursive: true });
		expect((await runProcess("git", ["status", "--porcelain"], fixture.directory)).stdout).toBe("");

		const second = await runTurbo(fixture.directory, server.url);
		expect(cacheHash(second.stdout)).toBe(firstHash);
		expect(second.stdout).toMatch(/cache hit/i);
		expect(await readFile(fixture.counterPath, "utf8")).toBe("1");
		expect(await readFile(join(fixture.directory, "dist", "output.txt"), "utf8")).toBe("run 1\n");
	});
});

async function createTurboFixture(): Promise<TurboFixture> {
	const directory = await mkdtemp(join(tmpdir(), "turboflare-turbo-"));
	const counterPath = `${directory}.runs`;
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify(
			{
				name: "turboflare-fixture",
				packageManager: "pnpm@11.5.0",
				private: true,
				scripts: {
					build: "node build.mjs",
				},
			},
			null,
			2
		)
	);
	await writeFile(join(directory, ".gitignore"), ".runs\n.turbo\nnode_modules\n");
	await writeFile(
		join(directory, "pnpm-lock.yaml"),
		["lockfileVersion: '9.0'", "", "settings:", "  autoInstallPeers: true", "  excludeLinksFromLockfile: false", "", "importers:", "", "  .: {}", ""].join("\n")
	);
	await writeFile(join(directory, "turbo.json"), JSON.stringify({ tasks: { build: { outputs: ["dist/**"] } } }, null, 2));
	await writeFile(
		join(directory, "build.mjs"),
		[
			'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
			`const counterPath = ${JSON.stringify(counterPath)};`,
			'const count = existsSync(counterPath) ? Number(readFileSync(counterPath, "utf8")) + 1 : 1;',
			'writeFileSync(counterPath, String(count));',
			'mkdirSync("dist", { recursive: true });',
			'writeFileSync("dist/output.txt", `run ${count}\\n`);',
		].join("\n")
	);
	await runProcess("git", ["init"], directory);
	await runProcess("git", ["add", "."], directory);
	await runProcess("git", ["-c", "user.email=turboflare@example.com", "-c", "user.name=turboflare", "commit", "-m", "init"], directory);
	return { counterPath, directory };
}

function cacheHash(stdout: string): string {
	const match = stdout.match(/cache (?:miss|hit).*?([a-f0-9]{16})/i);
	if (match === null) {
		throw new Error(stdout);
	}

	return match[1];
}

function runTurbo(cwd: string, turboApi: string): Promise<{ stderr: string; stdout: string }> {
	return runProcess(TURBO_BIN, ["run", "build", "--output-logs=full"], cwd, {
		FORCE_COLOR: "0",
		NO_COLOR: "1",
		TURBO_API: turboApi,
		TURBO_CACHE: "remote:rw",
		TURBO_TEAM,
		TURBO_TELEMETRY_DISABLED: "1",
		TURBO_TOKEN,
	});
}

function runProcess(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ stderr: string; stdout: string }> {
	return new Promise((resolve, reject) => {
		execFile(command, [...args], { cwd, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
			if (error !== null) {
				reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
				return;
			}

			resolve({ stderr, stdout });
		});
	});
}

function startWorkerServer(env: Env): Promise<TestServer> {
	return new Promise((resolve, reject) => {
		const server = createServer(async (incoming, outgoing) => {
			try {
				const request = toRequest(incoming);
				const response = await handleRequest(request, env, executionContext());
				await writeResponse(outgoing, response);
			} catch (error) {
				outgoing.statusCode = 500;
				outgoing.end(error instanceof Error ? error.message : "internal error");
			}
		});

		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("server did not bind to a tcp port"));
				return;
			}

			const serverUrl = `http://127.0.0.1:${address.port}`;
			resolve({ close: () => closeServer(server), url: serverUrl });
		});
	});
}

function toRequest(incoming: IncomingMessage): Request {
	const headers = new Headers();
	for (const [key, value] of Object.entries(incoming.headers)) {
		if (value === undefined) {
			continue;
		}

		headers.set(key, Array.isArray(value) ? value.join(", ") : value);
	}

	const url = `http://${incoming.headers.host}${incoming.url ?? "/"}`;
	const method = incoming.method ?? "GET";
	const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming);
	return new Request(url, { body, duplex: "half", headers, method } as RequestInit & { duplex: "half" });
}

async function writeResponse(outgoing: ServerResponse, response: Response): Promise<void> {
	outgoing.statusCode = response.status;
	outgoing.statusMessage = response.statusText;
	response.headers.forEach((value, key) => outgoing.setHeader(key, value));

	if (response.body === null) {
		outgoing.end();
		return;
	}

	await new Promise<void>((resolve, reject) => {
		Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>).on("error", reject).pipe(outgoing).on("error", reject).on("finish", resolve);
	});
}

function executionContext(): ExecutionContext {
	return {
		passThroughOnException() {},
		waitUntil(promise) {
			void promise;
		},
	} as ExecutionContext;
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
}

class MemoryR2Bucket {
	readonly objects = new Map<string, StoredObject>();

	async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null, options?: R2PutOptions): Promise<R2Object> {
		const body = await bodyBytes(value);
		const object = storedObject(key, body, options);
		this.objects.set(key, object);
		return r2Object(object);
	}

	async get(key: string): Promise<R2ObjectBody | null> {
		const object = this.objects.get(key);
		return object === undefined ? null : r2ObjectBody(object);
	}

	async head(key: string): Promise<R2Object | null> {
		const object = this.objects.get(key);
		return object === undefined ? null : r2Object(object);
	}
}

async function bodyBytes(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null): Promise<Uint8Array<ArrayBuffer>> {
	if (value === null) {
		return new Uint8Array();
	}

	if (typeof value === "string") {
		return new TextEncoder().encode(value);
	}

	if (ArrayBuffer.isView(value)) {
		return copyBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
	}

	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}

	return new Uint8Array(await new Response(value).arrayBuffer());
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy;
}

function storedObject(key: string, body: Uint8Array<ArrayBuffer>, options: R2PutOptions | undefined): StoredObject {
	return {
		body,
		customMetadata: options?.customMetadata,
		etag: crypto.randomUUID().replaceAll("-", ""),
		httpMetadata: r2HttpMetadata(options?.httpMetadata),
		key,
		uploaded: new Date(),
	};
}

function r2HttpMetadata(metadata: Headers | R2HTTPMetadata | undefined): R2HTTPMetadata | undefined {
	return metadata instanceof Headers ? { contentType: metadata.get("Content-Type") ?? undefined } : metadata;
}

function r2Object(object: StoredObject): R2Object {
	return {
		checksums: {} as R2Checksums,
		customMetadata: object.customMetadata,
		etag: object.etag,
		httpEtag: `"${object.etag}"`,
		httpMetadata: object.httpMetadata,
		key: object.key,
		size: object.body.byteLength,
		uploaded: object.uploaded,
		version: object.etag,
		writeHttpMetadata(headers) {
			if (object.httpMetadata?.contentType !== undefined) {
				headers.set("Content-Type", object.httpMetadata.contentType);
			}
		},
	} as R2Object;
}

function r2ObjectBody(object: StoredObject): R2ObjectBody {
	return {
		...r2Object(object),
		body: new Response(object.body).body,
		bodyUsed: false,
		arrayBuffer: () => Promise.resolve(object.body.buffer.slice(object.body.byteOffset, object.body.byteOffset + object.body.byteLength)),
		blob: () => Promise.resolve(new Blob([object.body])),
		json: async () => JSON.parse(await new Response(object.body).text()) as unknown,
		text: () => new Response(object.body).text(),
	} as R2ObjectBody;
}
