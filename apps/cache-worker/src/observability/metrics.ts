import type { Env } from "../app/env";
import type { MetricPoint } from "./types";

const ARTIFACT_ID_SAMPLE_LENGTH = 16;

export function recordMetric(env: Env, ctx: ExecutionContext, point: MetricPoint): void {
	if (env.ANALYTICS === undefined) {
		return;
	}

	ctx.waitUntil(writeMetric(env.ANALYTICS, point).catch(() => undefined));
}

async function writeMetric(analytics: AnalyticsEngineDataset, point: MetricPoint): Promise<void> {
	analytics.writeDataPoint({
		blobs: [point.event, point.method, point.tenant ?? "", artifactSample(point.artifactId), point.tokenId ?? ""],
		doubles: [point.status, point.bytes ?? 0, Date.now()],
		indexes: [point.tenant ?? "global"],
	});
}

function artifactSample(artifactId: string | undefined): string {
	return artifactId === undefined ? "" : artifactId.slice(0, ARTIFACT_ID_SAMPLE_LENGTH);
}
