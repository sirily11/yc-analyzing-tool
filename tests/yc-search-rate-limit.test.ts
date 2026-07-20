import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  consumeYcSemanticSearchLimit,
  ycSemanticSearchClientKey,
} from "@/lib/yc/search-rate-limit";

describe("public semantic-search rate limit", () => {
  it("uses a keyed client fingerprint without retaining the source address", () => {
    const request = new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" } });
    const key = ycSemanticSearchClientKey(request, { AUTH_SECRET: "test-secret" });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.42");
  });

  it("atomically limits one client and resets the fixed window", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "yc-rate-limit-"));
    const client = createClient({ url: `file:${path.join(directory, "rate-limit.db")}` });
    try {
      await client.execute(`CREATE TABLE yc_semantic_search_rate_limits (
        client_key TEXT PRIMARY KEY NOT NULL,
        window_started_at INTEGER NOT NULL,
        request_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      const request = new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.42" } });
      const options = {
        executor: client,
        limit: 1,
        environment: { AUTH_SECRET: "test-secret" },
      };

      await expect(consumeYcSemanticSearchLimit(request, {
        ...options,
        now: new Date("2026-07-20T00:00:00.000Z"),
      })).resolves.toMatchObject({ allowed: true, remaining: 0 });
      await expect(consumeYcSemanticSearchLimit(request, {
        ...options,
        now: new Date("2026-07-20T00:00:01.000Z"),
      })).resolves.toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 59 });
      await expect(consumeYcSemanticSearchLimit(request, {
        ...options,
        now: new Date("2026-07-20T00:01:01.000Z"),
      })).resolves.toMatchObject({ allowed: true, remaining: 0 });
    } finally {
      client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
