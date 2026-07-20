import { describe, expect, it } from "vitest";
import { chatToolErrorMessage } from "@/lib/ai/chat-error";

describe("chat tool error copy", () => {
  it("does not imply that public company research requires a PDF", () => {
    const wrapped = new Error("Tool execution failed", { cause: new Error("COMPANY_RESEARCH_CONFIRMATION_REQUIRED") });
    expect(chatToolErrorMessage(wrapped)).toBe("Company research approval was not available for this tool call.");
    expect(chatToolErrorMessage(new Error("FIRECRAWL_NOT_CONFIGURED"))).toBe("Public company research is not configured on the server yet.");
    expect(chatToolErrorMessage(new Error("FIRECRAWL_RESEARCH_UNAVAILABLE"))).toBe("No usable live public sources were retrieved for this company research.");
  });

  it("keeps PDF guidance limited to an unavailable pitch-deck source", () => {
    expect(chatToolErrorMessage(new Error("DOCUMENT_NOT_AVAILABLE"))).toContain("Attach the PDF again");
    expect(chatToolErrorMessage(new Error("UNEXPECTED_FAILURE"))).not.toContain("PDF");
  });
});
