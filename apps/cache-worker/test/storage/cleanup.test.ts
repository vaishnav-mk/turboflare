import { describe, it } from "vitest";

import { cleanupExpiredArtifacts, type Env } from "../../src";
import { daysAgo } from "../helpers/time";

interface StoredListObject {
	key: string;
	uploaded: Date;
}

describe("cleanupExpiredArtifacts", () => {
	it("deletes only expired v1 artifacts", async ({ expect }) => {
		const bucket = new CleanupBucket([
			{ key: "v1/team/a/artifact/old", uploaded: daysAgo(40) },
			{ key: "v1/team/a/artifact/new", uploaded: daysAgo(2) },
			{ key: "legacy/team/a/artifact/old", uploaded: daysAgo(40) },
		]);

		const result = await cleanupExpiredArtifacts({ ARTIFACTS: bucket as unknown as R2Bucket, RETENTION_DAYS: "30" } satisfies Env, Date.now());

		expect(result).toEqual({ deleted: 1, scanned: 2 });
		expect(bucket.deleted).toEqual(["v1/team/a/artifact/old"]);
	});

	it("respects cleanup max delete", async ({ expect }) => {
		const bucket = new CleanupBucket([
			{ key: "v1/team/a/artifact/one", uploaded: daysAgo(40) },
			{ key: "v1/team/a/artifact/two", uploaded: daysAgo(40) },
			{ key: "v1/team/a/artifact/three", uploaded: daysAgo(40) },
		]);

		const result = await cleanupExpiredArtifacts({ ARTIFACTS: bucket as unknown as R2Bucket, CLEANUP_MAX_DELETE: "2", RETENTION_DAYS: "30" } satisfies Env, Date.now());

		expect(result.deleted).toBe(2);
		expect(bucket.deleted).toHaveLength(2);
	});

	it("can be disabled with zero retention or zero max delete", async ({ expect }) => {
		const bucket = new CleanupBucket([{ key: "v1/team/a/artifact/old", uploaded: daysAgo(40) }]);

		expect(await cleanupExpiredArtifacts({ ARTIFACTS: bucket as unknown as R2Bucket, RETENTION_DAYS: "0" } satisfies Env, Date.now())).toEqual({ deleted: 0, scanned: 0 });
		expect(await cleanupExpiredArtifacts({ ARTIFACTS: bucket as unknown as R2Bucket, CLEANUP_MAX_DELETE: "0" } satisfies Env, Date.now())).toEqual({ deleted: 0, scanned: 0 });
		expect(bucket.deleted).toEqual([]);
	});

	it("supports shorter branch retention", async ({ expect }) => {
		const bucket = new CleanupBucket([
			{ key: "v1/team/a/artifact/main", uploaded: daysAgo(10) },
			{ key: "v1/team/a/branch/pr-1/artifact/old", uploaded: daysAgo(10) },
			{ key: "v1/team/a/branch/pr-1/artifact/new", uploaded: daysAgo(1) },
		]);

		const result = await cleanupExpiredArtifacts({ ARTIFACTS: bucket as unknown as R2Bucket, BRANCH_RETENTION_DAYS: "7", RETENTION_DAYS: "30" } satisfies Env, Date.now());

		expect(result).toEqual({ deleted: 1, scanned: 3 });
		expect(bucket.deleted).toEqual(["v1/team/a/branch/pr-1/artifact/old"]);
	});
});

class CleanupBucket {
	readonly deleted: string[] = [];

	constructor(private readonly objects: StoredListObject[]) {}

	async list(options: R2ListOptions): Promise<R2Objects> {
		const filtered = this.objects.filter((object) => object.key.startsWith(options.prefix ?? ""));
		return {
			delimitedPrefixes: [],
			objects: filtered.map((object) => ({
				checksums: {} as R2Checksums,
				etag: object.key,
				httpEtag: `"${object.key}"`,
				key: object.key,
				size: 1,
				storageClass: "Standard",
				uploaded: object.uploaded,
				version: object.key,
				writeHttpMetadata() {},
			})) as unknown as R2Object[],
			truncated: false,
		};
	}

	async delete(keys: string | string[]): Promise<void> {
		this.deleted.push(...(Array.isArray(keys) ? keys : [keys]));
	}
}
