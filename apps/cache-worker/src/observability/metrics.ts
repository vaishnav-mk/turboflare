import type { Env } from "../app/env";
import type { MetricPoint } from "./types";

const ARTIFACT_ID_SAMPLE_LENGTH = 16;

export function recordMetric(env: Env, ctx: ExecutionContext, point: MetricPoint): void {
  if (env.ANALYTICS === undefined) {
    return;
  }

  const write = writeMetric(env.ANALYTICS, point);
  const guardedWrite = write.catch(() => undefined);
  ctx.waitUntil(guardedWrite);
}

async function writeMetric(analytics: AnalyticsEngineDataset, point: MetricPoint): Promise<void> {
  const artifact = artifactSample(point.artifactId);
  const now = Date.now();
  analytics.writeDataPoint({
    blobs: [point.event, point.method, point.tenant ?? "", artifact, point.tokenId ?? ""],
    doubles: [point.status, point.bytes ?? 0, now],
    indexes: [point.tenant ?? "global"],
  });
}

function artifactSample(artifactId: string | undefined): string {
  return artifactId === undefined ? "" : artifactId.slice(0, ARTIFACT_ID_SAMPLE_LENGTH);
}
