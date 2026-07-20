import { describe, expect, it } from "vitest";
import { CHAT_AUTO_SCROLL_THRESHOLD_PX, isNearChatScrollEnd } from "@/lib/chat-scroll";

describe("chat auto-scroll threshold", () => {
  it("keeps following messages when the viewport is close to the end", () => {
    expect(isNearChatScrollEnd({ scrollHeight: 1_000, scrollTop: 340, clientHeight: 500 })).toBe(true);
  });

  it("stops following messages when the viewport is above the threshold", () => {
    expect(isNearChatScrollEnd({ scrollHeight: 1_000, scrollTop: 339, clientHeight: 500 })).toBe(false);
  });

  it("uses the configured threshold at its boundary", () => {
    expect(isNearChatScrollEnd({ scrollHeight: 1_000, scrollTop: 500 - CHAT_AUTO_SCROLL_THRESHOLD_PX, clientHeight: 500 })).toBe(true);
  });
});
