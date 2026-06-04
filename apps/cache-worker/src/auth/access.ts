import { errorResponse } from "@turboflare/shared";

import { appConfig, type Env } from "../app/env";

interface AccessJwtHeader {
	alg?: unknown;
	kid?: unknown;
}

interface AccessJwtPayload {
	aud?: unknown;
	exp?: unknown;
	iss?: unknown;
	nbf?: unknown;
}

interface AccessJwks {
	keys?: unknown;
}

interface AccessJsonWebKey extends JsonWebKey {
	kid?: string;
	kty?: string;
}

interface ParsedJwt {
	header: AccessJwtHeader;
	payload: AccessJwtPayload;
	signature: Uint8Array;
	signingInput: Uint8Array;
}

const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";
const ACCESS_CERTS_PATH = "/cdn-cgi/access/certs";
const JWKS_CACHE_MS = 300_000;
const SUPPORTED_ALGORITHM = "RS256";

let cachedJwksExpiresAt = 0;
let cachedJwksKeys: readonly AccessJsonWebKey[] = [];
let cachedJwksUrl: string | undefined;

export async function requireAccess(request: Request, env: Env): Promise<Response | null> {
	const config = appConfig(env);
	if (config.internalAccessBypass) {
		return null;
	}

	const assertion = request.headers.get(ACCESS_ASSERTION_HEADER);
	if (assertion === null || assertion.length === 0) {
		return errorResponse(401, "unauthorized", "Missing Cloudflare Access assertion");
	}

	if (config.internalAccessTeamDomain === undefined || config.internalAccessAudiences.length === 0) {
		return errorResponse(403, "forbidden", "Cloudflare Access assertion verification is not configured");
	}

	const parsed = parseJwt(assertion);
	if (parsed === null) {
		return errorResponse(403, "forbidden", "Invalid Cloudflare Access assertion");
	}

	const keys = await accessKeys(env, config.internalAccessTeamDomain);
	if (keys === null) {
		return errorResponse(503, "unavailable", "Cloudflare Access certs unavailable");
	}

	if (keys.length === 0 || !(await verifyJwt(parsed, keys)) || !validClaims(parsed.payload, config.internalAccessTeamDomain, config.internalAccessAudiences)) {
		return errorResponse(403, "forbidden", "Invalid Cloudflare Access assertion");
	}

	return null;
}

async function accessKeys(env: Env, teamDomain: string): Promise<readonly AccessJsonWebKey[] | null> {
	const config = appConfig(env);
	if (config.internalAccessJwks !== undefined) {
		return parseJwks(config.internalAccessJwks);
	}

	const url = config.internalAccessJwksUrl ?? `${teamDomain}${ACCESS_CERTS_PATH}`;
	if (cachedJwksUrl === url && cachedJwksExpiresAt > Date.now()) {
		return cachedJwksKeys;
	}

	let response: Response;
	try {
		response = await fetch(url);
	} catch {
		return null;
	}

	if (!response.ok) {
		return null;
	}

	const keys = parseJwks(await response.text());
	cachedJwksUrl = url;
	cachedJwksExpiresAt = Date.now() + JWKS_CACHE_MS;
	cachedJwksKeys = keys;
	return keys;
}

function parseJwks(value: string): readonly AccessJsonWebKey[] {
	try {
		const parsed = JSON.parse(value) as AccessJwks;
		return Array.isArray(parsed.keys) ? parsed.keys.filter(isJsonWebKey) : [];
	} catch {
		return [];
	}
}

async function verifyJwt(jwt: ParsedJwt, keys: readonly AccessJsonWebKey[]): Promise<boolean> {
	if (jwt.header.alg !== SUPPORTED_ALGORITHM || typeof jwt.header.kid !== "string") {
		return false;
	}

	const jwk = keys.find((key) => key.kid === jwt.header.kid && key.kty === "RSA");
	if (jwk === undefined) {
		return false;
	}

	try {
		const key = await crypto.subtle.importKey("jwk", jwk, { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" }, false, ["verify"]);
		return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, arrayBuffer(jwt.signature), arrayBuffer(jwt.signingInput));
	} catch {
		return false;
	}
}

function validClaims(payload: AccessJwtPayload, issuer: string, expectedAudiences: readonly string[], now = Date.now()): boolean {
	if (payload.iss !== issuer || typeof payload.exp !== "number" || payload.exp * 1000 <= now) {
		return false;
	}

	if (typeof payload.nbf === "number" && payload.nbf * 1000 > now) {
		return false;
	}

	return audiences(payload.aud).some((audience) => expectedAudiences.includes(audience));
}

function audiences(value: unknown): readonly string[] {
	if (typeof value === "string") {
		return [value];
	}

	return Array.isArray(value) ? value.filter((audience): audience is string => typeof audience === "string") : [];
}

function parseJwt(assertion: string): ParsedJwt | null {
	const parts = assertion.split(".");
	if (parts.length !== 3) {
		return null;
	}

	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	const header = jsonPart<AccessJwtHeader>(encodedHeader);
	const payload = jsonPart<AccessJwtPayload>(encodedPayload);
	const signature = bytesPart(encodedSignature);
	if (header === null || payload === null || signature === null) {
		return null;
	}

	return {
		header,
		payload,
		signature,
		signingInput: new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
	};
}

function jsonPart<T extends object>(value: string): T | null {
	const bytes = bytesPart(value);
	if (bytes === null) {
		return null;
	}

	try {
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
	} catch {
		return null;
	}
}

function bytesPart(value: string): Uint8Array | null {
	if (value.length % 4 === 1) {
		return null;
	}

	try {
		const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		const binary = atob(padded);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isJsonWebKey(value: unknown): value is AccessJsonWebKey {
	return value !== null && typeof value === "object";
}
