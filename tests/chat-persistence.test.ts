import { describe, expect, it, vi } from "vitest";
import { persistChatCompletion } from "@/lib/ai/chat-persistence";

describe("chat completion persistence", () => {
  it("retries a transient persistence failure", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(undefined);

    await expect(persistChatCompletion(persist, { retryDelaysMs: [0] })).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("does not reject the response stream after retries are exhausted", async () => {
    const failure = new Error("network error");
    const persist = vi.fn().mockRejectedValue(failure);
    const onFailure = vi.fn();

    await expect(persistChatCompletion(persist, { retryDelaysMs: [0, 0], onFailure })).resolves.toBe(false);
    expect(persist).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});
