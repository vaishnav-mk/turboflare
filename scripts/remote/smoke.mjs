import {
  ARTIFACTS_PATH,
  ARTIFACT_EVENTS_PATH,
  ARTIFACT_STATUS_PATH,
  RouteAction,
  RoutePath,
} from "../../packages/protocol/dist/paths.js";
import { requiredEnv } from "../shared/env.mjs";

const r2Api = requiredEnv("TURBOFLARE_R2_API");
const kvApi = requiredEnv("TURBOFLARE_KV_API");
const token = requiredEnv("TURBOFLARE_TOKEN");
const adminToken = requiredEnv("TURBOFLARE_ADMIN_TOKEN");
const team = process.env.TURBOFLARE_TEAM ?? `remote-smoke-${Date.now()}`;
const encodedTeam = encodeURIComponent(team);

const results = [];

await check("r2 health", async () => {
  const response = await fetch(`${r2Api}/management/health`);
  assertStatus(response, 200);
});

await check("r2 rejects unauthenticated status", async () => {
  const response = await fetch(`${r2Api}${ARTIFACT_STATUS_PATH}`);
  assertStatus(response, 401);
});

await check("r2 authenticated status", async () => {
  const response = await authedFetch(`${r2Api}${ARTIFACT_STATUS_PATH}`);
  assertStatus(response, 200);
  const body = await response.json();
  assert(body.status === "enabled", `expected enabled status, got ${JSON.stringify(body)}`);
});

await check("r2 v2 compatibility", async () => {
  const user = await authedFetch(`${r2Api}${RoutePath.TurboIdentityUser}`);
  assertStatus(user, 200);
  const teamResponse = await authedFetch(`${r2Api}${RoutePath.TurboIdentityTeams}/${encodedTeam}`);
  assertStatus(teamResponse, 200);
});

await check("r2 preflight", async () => {
  const response = await fetch(
    `${r2Api}${ARTIFACTS_PATH}/preflight-${Date.now()}?teamId=${encodedTeam}`,
    {
      method: "OPTIONS",
    },
  );
  assertStatus(response, 204);
  assert(
    response.headers.get("access-control-allow-methods")?.includes("PUT"),
    "missing PUT CORS method",
  );
});

await check("r2 put head get lookup events", async () => {
  const id = `artifact-${Date.now()}`;
  const path = `${ARTIFACTS_PATH}/${id}?teamId=${encodedTeam}`;
  const bytes = new TextEncoder().encode("hello-r2");
  const put = await putBytes(`${r2Api}${path}`, bytes, {
    "x-artifact-duration": "12",
    "x-artifact-tag": "remote#r2",
  });
  assertStatus(put, 200);

  const head = await authedFetch(`${r2Api}${path}`, { method: "HEAD" });
  assertStatus(head, 200);
  assert(head.headers.get("content-length") === String(bytes.byteLength), "bad content-length");

  const get = await authedFetch(`${r2Api}${path}`);
  assertStatus(get, 200);
  const getText = await get.text();
  assertText(getText, "hello-r2");

  const lookup = await authedFetch(`${r2Api}${ARTIFACTS_PATH}?teamId=${encodedTeam}`, {
    body: JSON.stringify({ hashes: [id, `missing-${id}`] }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assertStatus(lookup, 200);
  const lookupBody = await lookup.json();
  assert(
    lookupBody[id]?.size === bytes.byteLength && lookupBody[`missing-${id}`] === null,
    `bad lookup ${JSON.stringify(lookupBody)}`,
  );

  const events = await authedFetch(`${r2Api}${ARTIFACT_EVENTS_PATH}`, {
    body: JSON.stringify([{ duration: 1, event: "HIT", hash: id, source: "REMOTE" }]),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assertStatus(events, 200);
});

await check("r2 upload validation", async () => {
  const id = `validation-${Date.now()}`;
  const textUpload = await putBytes(
    `${r2Api}${ARTIFACTS_PATH}/${id}?teamId=${encodedTeam}`,
    new Uint8Array([1]),
    {
      "Content-Type": "text/plain",
    },
  );
  assertStatus(textUpload, 400);
  const largeBytes = new Uint8Array(1024 * 1024 + 1);
  const largeUpload = await putBytes(
    `${r2Api}${ARTIFACTS_PATH}/${id}-large?teamId=${encodedTeam}`,
    largeBytes,
  );
  assertStatus(largeUpload, 413);
  const noLength = await fetch(`${r2Api}${ARTIFACTS_PATH}/${id}-stream?teamId=${encodedTeam}`, {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        controller.close();
      },
    }),
    duplex: "half",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    method: "PUT",
  });
  assertStatus(noLength, 413);
});

await check("r2 cache api invalidates on overwrite", async () => {
  const id = `cache-${Date.now()}`;
  const url = `${r2Api}${ARTIFACTS_PATH}/${id}?teamId=${encodedTeam}`;
  const encoder = new TextEncoder();
  const oldBytes = encoder.encode("old");
  const oldPut = await putBytes(url, oldBytes);
  assertStatus(oldPut, 200);
  const oldGet = await authedFetch(url);
  const oldText = await oldGet.text();
  assertText(oldText, "old");
  const newBytes = encoder.encode("new");
  const newPut = await putBytes(url, newBytes);
  assertStatus(newPut, 200);
  const newGet = await authedFetch(url);
  const newText = await newGet.text();
  assertText(newText, "new");
});

await check("r2 branch fallback", async () => {
  const id = `branch-${Date.now()}`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode("main");
  const put = await putBytes(`${r2Api}${ARTIFACTS_PATH}/${id}?teamId=${encodedTeam}`, bytes);
  assertStatus(put, 200);
  const response = await authedFetch(
    `${r2Api}${ARTIFACTS_PATH}/${id}?teamId=${encodedTeam}&branch=pr-1`,
  );
  assertStatus(response, 200);
  const text = await response.text();
  assertText(text, "main");
});

await check("d1 token admin create duplicate revoke", async () => {
  const id = `tok_${Date.now()}`;
  const rawToken = `raw_${Date.now()}`;
  const body = { id, scopes: ["read", "write"], teams: [team], token: rawToken };
  const created = await adminFetch(`${r2Api}${RoutePath.InternalTokens}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assertStatus(created, 201);
  const duplicate = await adminFetch(`${r2Api}${RoutePath.InternalTokens}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assertStatus(duplicate, 409);
  const createdTokenPut = await fetch(
    `${r2Api}${ARTIFACTS_PATH}/d1-token-${Date.now()}?teamId=${encodedTeam}`,
    {
      body: new Uint8Array([7]),
      headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/octet-stream" },
      method: "PUT",
    },
  );
  assertStatus(createdTokenPut, 200);
  const encodedId = encodeURIComponent(id);
  const revoked = await adminFetch(
    `${r2Api}${RoutePath.InternalTokens}/${encodedId}/${RouteAction.Revoke}`,
    {
      method: "POST",
    },
  );
  assertStatus(revoked, 200);
  const revokedGet = await fetch(`${r2Api}${ARTIFACT_STATUS_PATH}`, {
    headers: { Authorization: `Bearer ${rawToken}` },
  });
  assertStatus(revokedGet, 401);
});

await check("internal stats and purge", async () => {
  const stats = await adminFetch(
    `${r2Api}${RoutePath.InternalTeams}/${encodedTeam}/${RouteAction.Stats}`,
  );
  assertStatus(stats, 200);
  const statsBody = await stats.json();
  assert(statsBody.objects > 0, `expected objects before purge, got ${JSON.stringify(statsBody)}`);
  const purge = await adminFetch(
    `${r2Api}${RoutePath.InternalTeams}/${encodedTeam}/${RouteAction.PurgeAll}`,
    {
      method: "POST",
    },
  );
  assertStatus(purge, 200);
  const purgeBody = await purge.json();
  assert(
    purgeBody.deleted >= statsBody.objects,
    `bad purge ${JSON.stringify(purgeBody)} stats ${JSON.stringify(statsBody)}`,
  );
  assert(purgeBody.truncated === false, `purge truncated ${JSON.stringify(purgeBody)}`);
});

await check("kv put head get lookup purge", async () => {
  const id = `kv-${Date.now()}`;
  const url = `${kvApi}${ARTIFACTS_PATH}/${id}?teamId=${encodedTeam}`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode("hello-kv");
  const put = await putBytes(url, bytes);
  assertStatus(put, 200);
  const head = await authedFetch(url, { method: "HEAD" });
  assertStatus(head, 200);
  const get = await authedFetch(url);
  const text = await get.text();
  assertText(text, "hello-kv");
  const lookup = await authedFetch(`${kvApi}${ARTIFACTS_PATH}?teamId=${encodedTeam}`, {
    body: JSON.stringify({ hashes: [id] }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assertStatus(lookup, 200);
  const body = await lookup.json();
  assert(body[id]?.size === 8, `bad kv lookup ${JSON.stringify(body)}`);
  const purge = await adminFetch(
    `${kvApi}${RoutePath.InternalTeams}/${encodedTeam}/${RouteAction.PurgeAll}`,
    {
      method: "POST",
    },
  );
  assertStatus(purge, 200);
});

console.log(JSON.stringify({ ok: results.every((result) => result.ok), results, team }, null, 2));
if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ durationMs: Date.now() - start, name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      name,
      ok: false,
    });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function authedFetch(url, init = {}) {
  const authedInit = withAuth(init, token);
  return fetch(url, authedInit);
}

function adminFetch(url, init = {}) {
  const authedInit = withAuth(init, adminToken);
  return fetch(url, authedInit);
}

function putBytes(url, bytes, headers = {}) {
  return authedFetch(url, {
    body: bytes,
    headers: {
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "application/octet-stream",
      ...headers,
    },
    method: "PUT",
  });
}

function withAuth(init, bearer) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${bearer}`);
  return { ...init, headers };
}

function assertStatus(response, status) {
  assert(response.status === status, `expected ${status}, got ${response.status}`);
}

function assertText(actual, expected) {
  assert(
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}
