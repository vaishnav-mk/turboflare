import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixture = join(root, "fixtures", "complex-turbo-monorepo");
const fixturePath = "fixtures/complex-turbo-monorepo";

rmSync(fixture, { force: true, recursive: true });
mkdirSync(join(fixture, "apps"), { recursive: true });
mkdirSync(join(fixture, "packages"), { recursive: true });

run("pnpm", ["dlx", "create-next-app@latest", `${fixturePath}/apps/web`, "--ts", "--app", "--src-dir", "--eslint", "--use-pnpm", "--skip-install", "--yes", "--disable-git"]);
writeBuildApprovalWorkspace(join(fixture, "apps", "web", "pnpm-workspace.yaml"));
run("pnpm", ["dlx", "create-vite@latest", `${fixturePath}/apps/dashboard`, "--template", "react-ts", "--no-interactive", "--overwrite"]);
run("pnpm", ["dlx", "create-astro@latest", `${fixturePath}/apps/docs`, "--template", "minimal", "--no-install", "--no-git", "--yes", "--skip-houston"]);
run("pnpm", ["create", "hono@latest", `${fixturePath}/apps/api`, "--template", "cloudflare-workers", "--pm", "pnpm", "--install"]);
run("pnpm", ["dlx", "create-vite@latest", `${fixturePath}/packages/ui`, "--template", "react-ts", "--no-interactive", "--overwrite"]);
run("pnpm", ["dlx", "create-vite@latest", `${fixturePath}/packages/math`, "--template", "vanilla-ts", "--no-interactive", "--overwrite"]);

writeJson(join(fixture, "package.json"), {
	name: "turboflare-complex-fixture",
	private: true,
	packageManager: "pnpm@11.5.0",
	scripts: {
		build: "turbo run build",
	},
	devDependencies: {
		turbo: "^2.9.16",
	},
});

writeFileSync(
	join(fixture, "pnpm-workspace.yaml"),
	["packages:", '  - "apps/*"', '  - "packages/*"', buildApprovals()].join("\n")
);
writeFileSync(join(fixture, ".gitignore"), [".turbo", "node_modules", "dist", ".next", ".wrangler", "apps/web/pnpm-lock.yaml", ""].join("\n"));

writeJson(join(fixture, "turbo.json"), {
	$schema: "https://turbo.build/schema.json",
	tasks: {
		build: {
			dependsOn: ["^build"],
			outputs: [".next/**", "dist/**"],
		},
	},
});

patchPackage(join(fixture, "apps", "api", "package.json"), (pkg) => {
	pkg.scripts = {
		...pkg.scripts,
		build: "wrangler deploy --dry-run --outdir dist",
	};
});
rmSync(join(fixture, "apps", "api", "node_modules"), { force: true, recursive: true });
rmSync(join(fixture, "apps", "api", "pnpm-lock.yaml"), { force: true });

patchPackage(join(fixture, "packages", "ui", "package.json"), (pkg) => {
	pkg.name = "@fixture/ui";
});

patchPackage(join(fixture, "packages", "math", "package.json"), (pkg) => {
	pkg.name = "@fixture/math";
});

patchPackage(join(fixture, "apps", "dashboard", "package.json"), (pkg) => {
	pkg.dependencies = { ...pkg.dependencies, "@fixture/math": "workspace:*", "@fixture/ui": "workspace:*" };
});

patchPackage(join(fixture, "apps", "docs", "package.json"), (pkg) => {
	pkg.dependencies = { ...pkg.dependencies, "@fixture/ui": "workspace:*" };
});

patchPackage(join(fixture, "apps", "api", "package.json"), (pkg) => {
	pkg.dependencies = { ...pkg.dependencies, "@fixture/math": "workspace:*" };
});

copyIfExists(join(root, "pnpm-workspace.yaml"), join(fixture, ".source-pnpm-workspace.yaml"));

run("pnpm", ["install", "--lockfile-only"], { cwd: fixture });

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { cwd: root, encoding: "utf8", shell: false, stdio: "inherit", ...options });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed`);
	}
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function patchPackage(path, patch) {
	const pkg = JSON.parse(readFileSync(path, "utf8"));
	patch(pkg);
	writeJson(path, pkg);
}

function copyIfExists(source, destination) {
	if (existsSync(source)) {
		cpSync(source, destination);
	}
}

function writeBuildApprovalWorkspace(path) {
	writeFileSync(path, `${buildApprovals()}\n`);
}

function buildApprovals() {
	return [
		"onlyBuiltDependencies:",
		"  - esbuild",
		"  - sharp",
		"  - unrs-resolver",
		"  - workerd",
		"allowBuilds:",
		"  esbuild: true",
		"  sharp: true",
		"  unrs-resolver: true",
		"  workerd: true",
		"",
	].join("\n");
}
