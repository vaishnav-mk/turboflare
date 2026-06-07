import type { Env } from "../app/env";
import type { MetricPoint } from "./types";

export function recordMetric(env: Env, point: MetricPoint): void {
  if (env.ANALYTICS === undefined) {
    return;
  }

  try {
    writeMetric(env.ANALYTICS, point);
  } catch {}
}

function writeMetric(analytics: AnalyticsEngineDataset, point: MetricPoint): void {
  const artifact = point.artifactId === undefined ? "" : point.artifactId.slice(0, 16);
  const now = Date.now();
  analytics.writeDataPoint({
    blobs: [point.event, point.method, point.tenant ?? "", artifact, point.tokenId ?? ""],
    doubles: [point.status, point.bytes ?? 0, now],
    indexes: [point.tenant ?? "global"],
  });
}
