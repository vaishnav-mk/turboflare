import { HttpMethod, RoutePath } from "@turboflare/protocol";

import type { Env } from "../../app/env";
import { ErrorCode, errorResponse, jsonResponse, methodNotAllowed } from "../../http/response";

interface MetricsSummaryRow {
  bytes?: number | string;
  errors?: number | string;
  events?: number | string;
  getHits?: number | string;
  getMisses?: number | string;
  headHits?: number | string;
  headMisses?: number | string;
  preflights?: number | string;
  puts?: number | string;
  requests?: number | string;
  signatureMissing?: number | string;
  status?: number | string;
}

const ANALYTICS_SQL_ENDPOINT = "https://api.cloudflare.com/client/v4/accounts";
const WINDOW_MINUTES = {
  "15m": 15,
  "1h": 60,
  "6h": 6 * 60,
  "24h": 24 * 60,
} as const;

type MetricsWindow = keyof typeof WINDOW_MINUTES;

export async function handleInternalMetrics(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== RoutePath.InternalMetricsSummary) {
    return null;
  }

  if (request.method !== HttpMethod.Get) {
    return methodNotAllowed([HttpMethod.Get]);
  }

  const config = metricsConfig(env);
  if (config === null) {
    return errorResponse(503, ErrorCode.Unavailable, "Analytics query access is not configured");
  }

  const window = metricsWindow(url.searchParams.get("window"));
  if (window === null) {
    return errorResponse(400, ErrorCode.BadRequest, "window must be one of 15m, 1h, 6h, or 24h");
  }

  const row = await queryMetricsSummary(config, window).catch(() => null);
  if (row === null) {
    return errorResponse(503, ErrorCode.Unavailable, "Analytics summary query failed");
  }

  return jsonResponse(summaryBody(window, row));
}

function metricsConfig(env: Env): { accountId: string; dataset: string; token: string } | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const dataset = env.ANALYTICS_DATASET?.trim();
  const token = env.ANALYTICS_API_TOKEN?.trim();
  if (accountId === undefined || accountId.length === 0) {
    return null;
  }
  if (token === undefined || token.length === 0) {
    return null;
  }
  if (dataset === undefined || !/^[A-Za-z0-9_]+$/.test(dataset)) {
    return null;
  }

  return { accountId, dataset, token };
}

function metricsWindow(value: string | null): MetricsWindow | null {
  if (value === null) {
    return "1h";
  }

  return value in WINDOW_MINUTES ? (value as MetricsWindow) : null;
}

async function queryMetricsSummary(
  config: { accountId: string; dataset: string; token: string },
  window: MetricsWindow,
): Promise<MetricsSummaryRow> {
  const response = await fetch(
    `${ANALYTICS_SQL_ENDPOINT}/${config.accountId}/analytics_engine/sql`,
    {
      body: metricsSummaryQuery(config.dataset, WINDOW_MINUTES[window]),
      headers: { Authorization: `Bearer ${config.token}` },
      method: HttpMethod.Post,
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`analytics summary query failed: ${response.status} ${text}`);
  }

  return text.trim().length === 0 ? {} : (JSON.parse(text.split("\n")[0]) as MetricsSummaryRow);
}

function metricsSummaryQuery(dataset: string, minutes: number): string {
  return `SELECT
  SUM(_sample_interval) AS requests,
  SUMIF(_sample_interval, blob1 = 'get_hit') AS getHits,
  SUMIF(_sample_interval, blob1 = 'get_miss') AS getMisses,
  SUMIF(_sample_interval, blob1 = 'head_hit') AS headHits,
  SUMIF(_sample_interval, blob1 = 'head_miss') AS headMisses,
  SUMIF(_sample_interval, blob1 = 'put') AS puts,
  SUMIF(_sample_interval, blob1 = 'preflight') AS preflights,
  SUMIF(_sample_interval, blob1 = 'events') AS events,
  SUMIF(_sample_interval, blob1 = 'status') AS status,
  SUMIF(_sample_interval, blob1 = 'signature_missing') AS signatureMissing,
  SUM(_sample_interval * double2) AS bytes,
  SUMIF(_sample_interval, double1 >= 400) AS errors
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '${minutes}' MINUTE
FORMAT JSONEachRow`;
}

function summaryBody(window: MetricsWindow, row: MetricsSummaryRow): Record<string, unknown> {
  const getHits = numberValue(row.getHits);
  const getMisses = numberValue(row.getMisses);
  const gets = getHits + getMisses;
  return {
    bytes: numberValue(row.bytes),
    errors: numberValue(row.errors),
    events: numberValue(row.events),
    getHits,
    getMisses,
    headHits: numberValue(row.headHits),
    headMisses: numberValue(row.headMisses),
    hitRate: gets === 0 ? null : getHits / gets,
    preflights: numberValue(row.preflights),
    puts: numberValue(row.puts),
    requests: numberValue(row.requests),
    signatureMissing: numberValue(row.signatureMissing),
    status: numberValue(row.status),
    window,
  };
}

function numberValue(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
