import "server-only";
import { createHmac } from "node:crypto";
import type { Client, Row } from "@libsql/client";
import { client } from "@/lib/db";

export const YC_PUBLIC_SEMANTIC_SEARCH_LIMIT = 30;
export const YC_PUBLIC_SEMANTIC_SEARCH_WINDOW_MS = 60_000;
const RATE_LIMIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type RateLimitExecutor = Pick<Client, "execute">;

function requiredNumber(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`YC_SEARCH_RATE_LIMIT_INVALID:${key}`);
  return value;
}

function clientIdentity(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip");
  return (forwarded?.split(",")[0]?.trim() || "unknown-client").slice(0, 256);
}

export function ycSemanticSearchClientKey(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const secret = environment.AUTH_SECRET?.trim()
    || environment.AI_GATEWAY_API_KEY?.trim()
    || "application-signal-rate-limit";
  return createHmac("sha256", secret).update(clientIdentity(request)).digest("hex");
}

export async function consumeYcSemanticSearchLimit(
  request: Request,
  options: {
    executor?: RateLimitExecutor;
    now?: Date;
    limit?: number;
    environment?: Readonly<Record<string, string | undefined>>;
  } = {},
) {
  const executor = options.executor ?? client;
  const now = (options.now ?? new Date()).getTime();
  const limit = options.limit ?? YC_PUBLIC_SEMANTIC_SEARCH_LIMIT;
  const resetBefore = now - YC_PUBLIC_SEMANTIC_SEARCH_WINDOW_MS;
  const clientKey = ycSemanticSearchClientKey(request, options.environment);
  const result = await executor.execute({
    sql: `INSERT INTO yc_semantic_search_rate_limits (
      client_key, window_started_at, request_count, updated_at
    ) VALUES (?, ?, 1, ?)
    ON CONFLICT(client_key) DO UPDATE SET
      request_count = CASE
        WHEN window_started_at <= ? THEN 1
        ELSE min(request_count + 1, ?)
      END,
      window_started_at = CASE
        WHEN window_started_at <= ? THEN excluded.window_started_at
        ELSE window_started_at
      END,
      updated_at = excluded.updated_at
    RETURNING request_count, window_started_at`,
    args: [clientKey, now, now, resetBefore, limit + 1, resetBefore],
  });
  const count = requiredNumber(result.rows[0], "request_count");
  const windowStartedAt = requiredNumber(result.rows[0], "window_started_at");

  if (clientKey.startsWith("00")) {
    await executor.execute({
      sql: "DELETE FROM yc_semantic_search_rate_limits WHERE updated_at < ?",
      args: [now - RATE_LIMIT_RETENTION_MS],
    }).catch(() => undefined);
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + YC_PUBLIC_SEMANTIC_SEARCH_WINDOW_MS - now) / 1_000)),
  };
}
