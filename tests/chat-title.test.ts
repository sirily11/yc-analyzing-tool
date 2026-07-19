import { describe, expect, it } from "vitest";
import { MAX_CHAT_TITLE_LENGTH, normalizeChatTitle, sanitizeGeneratedChatTitle } from "@/lib/chat-title";

describe("conversation titles", () => {
  it("normalizes a manually entered title without changing its wording", () => {
    expect(normalizeChatTitle("  My   YC\napplication  ")).toBe("My YC application");
  });

  it("removes common model formatting from generated titles", () => {
    expect(sanitizeGeneratedChatTitle('## Title: "Developer Tools Application"')).toBe("Developer Tools Application");
  });

  it("caps generated titles at the accepted server length", () => {
    expect(sanitizeGeneratedChatTitle("x".repeat(MAX_CHAT_TITLE_LENGTH + 10))).toHaveLength(MAX_CHAT_TITLE_LENGTH);
  });
});
