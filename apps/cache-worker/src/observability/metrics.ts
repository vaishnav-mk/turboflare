import type { Env } from "../app/env";
import type { MetricPoint } from "./types";

export function recordMetric(env: Env, ctx: ExecutionContext, point: MetricPoint): void {
	if (env.ANALYTICS === undefined) {
		return;
	}

	ctx.waitUntil(writeMetric(env.ANALYTICS, point));
}

async function writeMetric(analytics: AnalyticsEngineDataset, point: MetricPoint): Promise<void> {
	analytics.writeDataPoint({
		blobs: [point.event, point.method, point.tenant ?? "", point.artifactId ?? "", point.tokenId ?? ""],
		doubles: [point.status, point.bytes ?? 0, Date.now()],
		indexes: [point.tenant ?? "global"],
	});
}
