import { describe, expect, it } from "vitest";
import { resolveTitleModel } from "@/config";
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

  it("uses the dedicated title model independently of the chat model", () => {
    expect(resolveTitleModel({ AI_TITLE_MODEL: "title-model", AI_CHAT_MODEL: "chat-model" })).toBe("title-model");
    expect(resolveTitleModel({ AI_CHAT_MODEL: "chat-model" })).toBe("openai/gpt-5-nano");
  });
});
