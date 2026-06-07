interface ErrorBody {
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
