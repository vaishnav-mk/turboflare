export interface ErrorBody {
	error: {
		code: string;
		message: string;
	};
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set("Content-Type", "application/json; charset=utf-8");

	return new Response(JSON.stringify(body), {
		...init,
		headers,
	});
}

export function errorResponse(status: number, code: string, message: string, headers?: HeadersInit): Response {
	return jsonResponse(
		{
			error: {
				code,
				message,
			},
		} satisfies ErrorBody,
		{
			status,
			headers,
		}
	);
}

export function methodNotAllowed(methods: string[]): Response {
	return errorResponse(405, "method_not_allowed", "Method not allowed", {
		Allow: methods.join(", "),
	});
}

export function readBearerToken(request: Request): string | null {
	const authorization = request.headers.get("Authorization");
	if (authorization === null) {
		return null;
	}

	const parts = authorization.trim().split(/\s+/);
	if (parts.length !== 2) {
		return null;
	}

	const [scheme, token] = parts;
	if (scheme.toLowerCase() !== "bearer" || token.length === 0) {
		return null;
	}

	return token;
}

export function timingSafeEqual(left: string, right: string): boolean {
	const length = Math.max(left.length, right.length);
	let diff = left.length ^ right.length;

	for (let index = 0; index < length; index += 1) {
		const leftCode = index < left.length ? left.charCodeAt(index) : 0;
		const rightCode = index < right.length ? right.charCodeAt(index) : 0;
		diff |= leftCode ^ rightCode;
	}

	return diff === 0;
}
