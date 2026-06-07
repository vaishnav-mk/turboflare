import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, process.argv[2] ?? "dist");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

await runBuild();

createServer((request, response) => {
	const url = new URL(request.url ?? "/", `http://localhost:${port}`);
	const path = routePath(url.pathname);
	const file = existsSync(path) ? path : join(dist, "404.html");
	response.setHeader("Content-Type", contentType(file));
	createReadStream(file).pipe(response);
}).listen(port, () => {
	console.log(`docs: http://localhost:${port}`);
});

function routePath(pathname) {
	const decoded = decodeURIComponent(pathname);
	let target;
	if (decoded === "/") {
		target = join(dist, "index.html");
	} else if (decoded.endsWith("/")) {
		target = join(dist, decoded, "index.html");
	} else {
		const direct = join(dist, decoded);
		target = extname(decoded) === "" ? join(direct, "index.html") : direct;
	}

	const resolved = resolve(target);
	if (!resolved.startsWith(resolve(dist))) {
		return join(dist, "404.html");
	}
	return resolved;
}

function contentType(file) {
	switch (extname(file)) {
		case ".css":
			return "text/css; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".js":
			return "text/javascript; charset=utf-8";
		default:
			return "text/html; charset=utf-8";
	}
}

function runBuild() {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(root, "scripts", "build.mjs")], { stdio: "inherit" });
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build failed with ${code}`))));
	});
}
