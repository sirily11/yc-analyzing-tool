import { beforeEach, describe, expect, it, vi } from "vitest";

const getAvailableModels = vi.fn();
vi.mock("@ai-sdk/gateway", () => ({ gateway: { getAvailableModels: () => getAvailableModels() } }));
vi.mock("server-only", () => ({}));

const NANO = 1_000_000_000;

// The catalog is cached at module scope, so each test needs a fresh module instance.
async function freshPricing() {
  vi.resetModules();
  return (await import("@/lib/billing/pricing")).estimatedCostNanoUsd;
}

describe("gateway catalog pricing", () => {
  beforeEach(() => {
    getAvailableModels.mockReset();
    getAvailableModels.mockResolvedValue({
      models: [
        { id: "openai/gpt-5-nano", pricing: { input: "0.00000005", output: "0.0000004", cachedInputTokens: "0.000000005" } },
        { id: "openai/no-pricing", pricing: null },
      ],
    });
  });

  it("prices a title generation instead of recording it as free", async () => {
    const estimatedCostNanoUsd = await freshPricing();
    const cost = await estimatedCostNanoUsd("openai/gpt-5-nano", { inputTokens: 400, outputTokens: 10 });
    expect(cost).toBe(Math.round((400 * 0.00000005 + 10 * 0.0000004) * NANO));
    expect(cost).toBeGreaterThan(0);
  });

  it("charges cache reads at the cached rate and backs out uncached input tokens", async () => {
    const estimatedCostNanoUsd = await freshPricing();
    const cost = await estimatedCostNanoUsd("openai/gpt-5-nano", {
      inputTokens: 1_000,
      inputTokenDetails: { cacheReadTokens: 800 },
      outputTokens: 0,
    });
    expect(cost).toBe(Math.round((200 * 0.00000005 + 800 * 0.000000005) * NANO));
  });

  it("returns null for an unpriced model so the caller can flag manual review", async () => {
    const estimatedCostNanoUsd = await freshPricing();
    expect(await estimatedCostNanoUsd("openai/no-pricing", { inputTokens: 10 })).toBeNull();
    expect(await estimatedCostNanoUsd("openai/unknown", { inputTokens: 10 })).toBeNull();
  });

  it("returns null when the catalog is unreachable", async () => {
    const estimatedCostNanoUsd = await freshPricing();
    getAvailableModels.mockRejectedValue(new Error("GATEWAY_DOWN"));
    expect(await estimatedCostNanoUsd("openai/gpt-5-nano", { inputTokens: 10 })).toBeNull();
  });

  it("recovers on a later call after the catalog was unreachable", async () => {
    const estimatedCostNanoUsd = await freshPricing();
    getAvailableModels.mockRejectedValueOnce(new Error("GATEWAY_DOWN"));
    expect(await estimatedCostNanoUsd("openai/gpt-5-nano", { inputTokens: 10 })).toBeNull();
    expect(await estimatedCostNanoUsd("openai/gpt-5-nano", { inputTokens: 10 })).toBeGreaterThan(0);
  });

  it("fetches the catalog once for concurrent callers", async () => {
    const estimatedCostNanoUsd = await freshPricing();
    await Promise.all([
      estimatedCostNanoUsd("openai/gpt-5-nano", { inputTokens: 1 }),
      estimatedCostNanoUsd("openai/gpt-5-nano", { inputTokens: 1 }),
    ]);
    expect(getAvailableModels).toHaveBeenCalledTimes(1);
  });
});
