import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizePersistedToolStates, summarizeProviderError, summarizeToolCall, summarizeToolError, summarizeToolOutput } from "@/lib/ai/tool-log";

describe("chat tool logging", () => {
  it("summarizes research calls without logging the request text", () => {
    const summary = summarizeToolCall({
      toolName: "researchYcCompanies",
      toolCallId: "call-1",
      input: { companyIds: [1, 2], request: "Compare their private strategy in detail." },
    });

    expect(summary).toMatchObject({ toolName: "researchYcCompanies", toolCallId: "call-1", companyIds: [1, 2], requestLength: 41 });
    expect(JSON.stringify(summary)).not.toContain("private strategy");
  });

  it("logs only output shape and counts", () => {
    const summary = summarizeToolOutput({ reportId: "report-1", companies: [{ name: "Secret Co" }], sources: [{ url: "https://example.com" }], warnings: [] });
    expect(summary).toMatchObject({ reportId: "report-1", companyCount: 1, sourceCount: 1, warningCount: 0 });
    expect(JSON.stringify(summary)).not.toContain("Secret Co");
    expect(JSON.stringify(summary)).not.toContain("example.com");
  });

  it("marks a model-visible research failure without logging scrape URLs", () => {
    const summary = summarizeToolOutput({
      ok: false,
      error: { code: "FIRECRAWL_SCRAPE_FAILED", scrapeErrors: [{ url: "https://private.example", message: "closed" }] },
    });
    expect(summary).toMatchObject({ toolOutcome: "failed", errorCode: "FIRECRAWL_SCRAPE_FAILED", scrapeErrorCount: 1 });
    expect(JSON.stringify(summary)).not.toContain("private.example");
  });

  it("unwraps stable failure codes without exposing arbitrary messages", () => {
    const failure = new Error("Tool execution failed", { cause: new Error("FIRECRAWL_REQUEST_FAILED:429") });
    expect(summarizeToolError(failure)).toEqual({ errorCode: "FIRECRAWL_REQUEST_FAILED:429", errorNames: [] });
    expect(summarizeToolError(new Error("Sensitive provider response"))).toEqual({ errorCode: "UNEXPECTED_ERROR", errorNames: [] });
  });

  it("logs allowlisted provider diagnostics without request bodies or URL queries", () => {
    const apiError = Object.assign(new Error("Gateway request failed"), {
      name: "AI_APICallError",
      statusCode: 400,
      isRetryable: false,
      url: "https://ai-gateway.example/v1/ai/language-model?token=secret",
      requestBodyValues: { prompt: "private prompt" },
      responseHeaders: { "x-request-id": "request-123", authorization: "secret" },
      responseBody: JSON.stringify({
        error: { type: "invalid_request_error", code: "invalid_json_schema", message: "Invalid schema for response_format" },
        generationId: "generation-123",
      }),
    });
    const gatewayError = Object.assign(new Error("Invalid schema for response_format [generation-123]", { cause: apiError }), {
      name: "GatewayInvalidRequestError",
      statusCode: 400,
      type: "invalid_request_error",
      isRetryable: false,
      generationId: "generation-123",
    });

    const summary = summarizeProviderError(gatewayError);
    expect(summary).toMatchObject({
      providerStatusCodes: [400],
      providerRetryable: [false],
      providerErrorTypes: ["invalid_request_error"],
      providerErrorCodes: ["invalid_json_schema"],
      providerGenerationIds: ["generation-123"],
      providerRequestIds: ["x-request-id:request-123"],
      providerEndpoints: ["ai-gateway.example/v1/ai/language-model"],
    });
    expect(JSON.stringify(summary)).not.toContain("private prompt");
    expect(JSON.stringify(summary)).not.toContain("token=secret");
    expect(JSON.stringify(summary)).not.toContain("authorization");
  });

  it("captures confirmation scope and approval state from persisted messages", () => {
    const states = summarizePersistedToolStates([{
      id: "assistant-1",
      role: "assistant",
      parts: [{
        type: "tool-confirm",
        toolCallId: "confirm-1",
        state: "approval-responded",
        input: { action: "company-research", title: "Map companies", message: "Approve research" },
        approval: { id: "approval-1", approved: true },
      }],
    }]);

    expect(states).toEqual([{ toolName: "confirm", toolCallId: "confirm-1", state: "approval-responded", action: "company-research", approved: true }]);
  });
});
