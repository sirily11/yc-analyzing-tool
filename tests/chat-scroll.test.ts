import { describe, expect, it } from "vitest";
import { CHAT_AUTO_SCROLL_THRESHOLD_PX, isNearChatScrollEnd, updateChatAutoScrollState } from "@/lib/chat-scroll";

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

  it("does not treat an in-flight smooth-scroll event as the user leaving the end", () => {
    expect(updateChatAutoScrollState({ following: true, scrolling: true }, false)).toEqual({ following: true, scrolling: true });
  });

  it("stops following after the animation is cancelled and the user scrolls away", () => {
    expect(updateChatAutoScrollState({ following: true, scrolling: false }, false)).toEqual({ following: false, scrolling: false });
  });
});
