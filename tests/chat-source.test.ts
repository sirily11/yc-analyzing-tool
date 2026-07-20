import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { approvedConfirmationActions, assistantMessageHasRenderedToolResult, collectChatAnalysisText, confirmationInputSchema, createPdfUploadMessageParts, DEFAULT_PDF_REPORT_REQUEST, getPdfAttachment, getStopAnswer, getVisibleUserText, hasApprovedConfirmation, lastAssistantMessageHasStopCall, latestMessageRequestsPdfAnalysis, pdfAttachmentToModelPart, stopInputSchema, submittedPdfWorkflowIsTerminal } from "@/lib/ai/chat-source";

const attachment = {
  documentId: "0de282a1-3730-4d19-ad55-aac1a45da748",
  metadata: { kind: "pdf" as const, name: "RxArgo_Pitch_Deck.pdf", size: 786158, pages: 17, characters: 10384, sha256: "8b29f04d1810ee45b16b21816e6053caef42338041eb7dbc05e422f815735298" },
};

describe("chat analysis source", () => {
  it("requires every confirmation to declare its workflow action", () => {
    expect(confirmationInputSchema.safeParse({
      title: "Create company map",
      message: "Research public company sources.",
    }).success).toBe(false);
    expect(confirmationInputSchema.safeParse({
      action: "company-research",
      title: "Create company map",
      message: "Research public company sources.",
    }).success).toBe(true);
  });

  it("collects typed founder context without treating PDF upload metadata as a brief", () => {
    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "We build software for independent pharmacies." }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "Who pays?" }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "Pharmacies pay $200 monthly. Please score it." }] },
    ] satisfies UIMessage[];
    expect(collectChatAnalysisText(messages)).toBe("We build software for independent pharmacies.\n\nPharmacies pay $200 monthly. Please score it.");
  });

  it("starts fresh after a published report", () => {
    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "Old startup description" }] },
      { id: "2", role: "assistant", parts: [{ type: "tool-publishReport", toolCallId: "publish", state: "output-available", input: {}, output: {} }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "New version targets hospitals. Rescore it." }] },
    ] satisfies UIMessage[];
    expect(collectChatAnalysisText(messages)).toBe("New version targets hospitals. Rescore it.");
  });

  it("lets rich tool cards own the result instead of repeating it in assistant prose", () => {
    const rendered = { id: "result", role: "assistant", parts: [
      { type: "tool-searchYcCompanies", toolCallId: "search", state: "output-available", input: {}, output: { companies: [] } },
      { type: "text", text: "Here is the same company list again." },
    ] } as UIMessage;
    const failed = { id: "failed", role: "assistant", parts: [{ type: "tool-searchYcCompanies", toolCallId: "search", state: "output-error", input: {}, errorText: "Search failed" }] } as UIMessage;
    const visibleResearchFailure = { id: "research-failed", role: "assistant", parts: [
      { type: "tool-searchYcCompanies", toolCallId: "search", state: "output-available", input: {}, output: { companies: [] } },
      { type: "tool-researchYcCompanies", toolCallId: "research", state: "output-available", input: {}, output: { ok: false, error: { code: "FIRECRAWL_SCRAPE_FAILED", message: "Scrape failed" } } },
      { type: "text", text: "Firecrawl could not scrape the requested pages." },
    ] } as UIMessage;
    const unknown = { id: "unknown", role: "assistant", parts: [{ type: "tool-customTool", toolCallId: "custom", state: "output-available", input: {}, output: {} }] } as UIMessage;

    expect(assistantMessageHasRenderedToolResult(rendered)).toBe(true);
    expect(assistantMessageHasRenderedToolResult(failed)).toBe(false);
    expect(assistantMessageHasRenderedToolResult(visibleResearchFailure)).toBe(false);
    expect(assistantMessageHasRenderedToolResult(unknown)).toBe(false);
  });

  it("reads the terminal answer and detects that the agent explicitly stopped", () => {
    const stopped = { id: "stopped", role: "assistant", parts: [{
      type: "tool-stop",
      toolCallId: "stop-1",
      state: "output-available",
      input: { answer: "**Final answer**" },
      output: { answer: "**Final answer**" },
    }] } as UIMessage;

    expect(stopInputSchema.safeParse({ answer: "" }).success).toBe(true);
    expect(getStopAnswer(stopped.parts[0])).toBe("**Final answer**");
    expect(lastAssistantMessageHasStopCall([stopped])).toBe(true);
    expect(lastAssistantMessageHasStopCall([{ id: "user", role: "user", parts: [{ type: "text", text: "Continue" }] }])).toBe(false);
  });

  it("keeps PDF metadata structured while exposing only the refined request", () => {
    const message = { id: "upload", role: "user", parts: createPdfUploadMessageParts(attachment, "") } satisfies UIMessage;

    expect(getPdfAttachment(message)).toEqual(attachment);
    expect(getVisibleUserText(message)).toBe(DEFAULT_PDF_REPORT_REQUEST);
    expect(collectChatAnalysisText([message])).toBeNull();
    expect(latestMessageRequestsPdfAnalysis([message])).toBe(true);
    expect(JSON.stringify(getVisibleUserText(message))).not.toContain(attachment.documentId);
  });

  it("converts structured PDF data into an exact model-only reference", () => {
    const part = createPdfUploadMessageParts(attachment, "Score this pitch deck")[0];
    const modelPart = pdfAttachmentToModelPart(part);

    expect(modelPart?.text).toContain(`Document ID: ${attachment.documentId}`);
    expect(modelPart?.text).toContain(`\"sha256\":\"${attachment.metadata.sha256}\"`);
    expect(modelPart?.text).toContain("after confirmation");
  });

  it("returns only an approved, unconsumed dedicated confirmation", () => {
    const user = { id: "upload", role: "user", parts: createPdfUploadMessageParts(attachment, "Score it") } satisfies UIMessage;
    const confirmation = { id: "confirm", role: "assistant", parts: [{ type: "tool-confirm", toolCallId: "call-confirm", state: "approval-responded", input: { title: "Generate report?", message: "Analyze this pitch deck?" }, approval: { id: "approval", approved: true } }] } as UIMessage;

    expect(hasApprovedConfirmation([user, confirmation])).toBe(true);

    const consumed = { id: "analysis", role: "assistant", parts: [{ type: "tool-analyzeApplication", toolCallId: "call-analysis", state: "output-available", input: {}, output: {} }] } as UIMessage;
    expect(hasApprovedConfirmation([user, confirmation, consumed])).toBe(false);
  });

  it("keeps application and company-research approvals independently scoped", () => {
    const user = { id: "request", role: "user", parts: [{ type: "text", text: "Score my startup and research Stripe." }] } satisfies UIMessage;
    const applicationApproval = { id: "app-confirm", role: "assistant", parts: [{ type: "tool-confirm", toolCallId: "app-confirm-call", state: "approval-responded", input: { action: "application-analysis" }, approval: { id: "app-approval", approved: true } }] } as UIMessage;
    const researchApproval = { id: "research-confirm", role: "assistant", parts: [{ type: "tool-confirm", toolCallId: "research-confirm-call", state: "approval-responded", input: { action: "company-research" }, approval: { id: "research-approval", approved: true } }] } as UIMessage;

    expect([...approvedConfirmationActions([user, applicationApproval, researchApproval])]).toEqual(["application-analysis", "company-research"]);

    const applicationRun = { id: "analysis", role: "assistant", parts: [{ type: "tool-analyzeApplication", toolCallId: "analysis-call", state: "output-available", input: {}, output: {} }] } as UIMessage;
    expect(hasApprovedConfirmation([user, applicationApproval, researchApproval, applicationRun], "application-analysis")).toBe(false);
    expect(hasApprovedConfirmation([user, applicationApproval, researchApproval, applicationRun], "company-research")).toBe(true);

    const researchRun = { id: "research", role: "assistant", parts: [{ type: "tool-researchYcCompanies", toolCallId: "research-call", state: "output-available", input: {}, output: {} }] } as UIMessage;
    expect(hasApprovedConfirmation([user, applicationApproval, researchApproval, applicationRun, researchRun], "company-research")).toBe(false);
  });

  it("renders and detects legacy upload notices without showing their raw JSON", () => {
    const message = {
      id: "legacy",
      role: "user",
      parts: [{ type: "text", text: `I uploaded ${attachment.metadata.name}. Document ID: ${attachment.documentId}. Source metadata: ${JSON.stringify(attachment.metadata)}. Prepare a new report and request my approval before analyzing.` }],
    } satisfies UIMessage;

    expect(getPdfAttachment(message)).toEqual(attachment);
    expect(getVisibleUserText(message)).toBe(DEFAULT_PDF_REPORT_REQUEST);
    expect(latestMessageRequestsPdfAnalysis([message])).toBe(true);
    expect(collectChatAnalysisText([message])).toBeNull();
  });

  it("keeps a submitted PDF available through approval and releases the upload guard at terminal states", () => {
    const user = { id: "upload", role: "user", parts: createPdfUploadMessageParts(attachment, "Score it") } satisfies UIMessage;
    const approval = { id: "confirm", role: "assistant", parts: [{ type: "tool-confirm", toolCallId: "call-confirm", state: "approval-requested", input: {}, approval: { id: "approval" } }] } as UIMessage;
    expect(getPdfAttachment(user)?.documentId).toBe(attachment.documentId);
    expect(submittedPdfWorkflowIsTerminal([user, approval], attachment.documentId)).toBe(false);

    const published = { id: "publish", role: "assistant", parts: [{ type: "tool-publishReport", toolCallId: "call-publish", state: "output-available", input: {}, output: {} }] } as UIMessage;
    expect(submittedPdfWorkflowIsTerminal([user, approval, published], attachment.documentId)).toBe(true);
  });
});
