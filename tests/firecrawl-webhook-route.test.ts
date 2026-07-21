import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/research/firecrawl", () => ({ verifyFirecrawlSignature: vi.fn(() => true) }));
vi.mock("@/lib/research/report-research", () => ({ handleFirecrawlCompletion: vi.fn() }));
vi.mock("@/lib/research/log", () => ({ researchLog: vi.fn() }));

import { handleFirecrawlCompletion } from "@/lib/research/report-research";
import { POST } from "@/app/api/webhooks/firecrawl/route";

function request() {
  return new Request("https://app.example/api/webhooks/firecrawl", {
    method: "POST",
    headers: { "x-firecrawl-signature": `sha256=${"a".repeat(64)}` },
    body: JSON.stringify({
      id: "job-1",
      type: "crawl.completed",
      metadata: {
        reportId: "report-1",
        kind: "crawl",
        comparableCompanyId: 42,
        targets: [{ companyId: 42, url: "https://example.com/", sourceType: "company-website" }],
      },
    }),
  });
}

describe("Firecrawl webhook route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests provider retry when terminal state or usage is not durable", async () => {
    vi.mocked(handleFirecrawlCompletion).mockRejectedValue(new Error("BILLING_DB_UNAVAILABLE"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Webhook processing unavailable" });
  });

  it("acknowledges a terminal event only after processing succeeds", async () => {
    vi.mocked(handleFirecrawlCompletion).mockResolvedValue(true);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
  });
});
