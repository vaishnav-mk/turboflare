import { readBearerToken, timingSafeEqual } from "@turboflare/shared";

import type { Env } from "../app/env";
import { AuthScope, type AuthContext } from "./types";

const MAX_BEARER_TOKEN_LENGTH = 512;

let cachedRawTokens: string | undefined;
let cachedAllowedTokens: readonly string[] = [];

export function authorizeBearer(request: Request, env: Env, _scope: AuthScope): AuthContext | null {
	const token = readBearerToken(request);
	if (token === null || token.length > MAX_BEARER_TOKEN_LENGTH) {
		return null;
	}

	const tokens = allowedTokens(env.TURBO_TOKEN);
	const tokenIndex = tokens.findIndex((allowedToken) => timingSafeEqual(token, allowedToken));
	if (tokenIndex === -1) {
		return null;
	}

	return {
		scopes: [AuthScope.Read, AuthScope.Write],
		tokenId: `static-${tokenIndex}`,
	};
}

function allowedTokens(rawTokens: string | undefined): readonly string[] {
	if (rawTokens === cachedRawTokens) {
		return cachedAllowedTokens;
	}

	cachedRawTokens = rawTokens;
	cachedAllowedTokens = parseAllowedTokens(rawTokens);
	return cachedAllowedTokens;
}

export function parseAllowedTokens(rawTokens: string | undefined): readonly string[] {
	if (rawTokens === undefined) {
		return [];
	}

	return rawTokens
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0 && token.length <= MAX_BEARER_TOKEN_LENGTH);
}
