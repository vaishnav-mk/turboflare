export function handleHealth(request: Request): Response | null {
	const url = new URL(request.url);
	if (request.method === "GET" && url.pathname === "/management/health") {
		return new Response(null, { status: 200 });
	}

	return null;
}

export function handleInternalHealth(request: Request): Response | null {
	const url = new URL(request.url);
	if (request.method === "GET" && url.pathname === "/internal/health") {
		return new Response(null, { status: 200 });
	}

	return null;
}
