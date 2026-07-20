import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ getCompanyResearchReport: vi.fn(), getReport: vi.fn() }));
vi.mock("@/lib/yc/companies", () => ({ getYcCompaniesByIds: vi.fn() }));
vi.mock("@/lib/analysis/company-research-run", () => ({
  CompanyResearchRunError: class CompanyResearchRunError extends Error {
    constructor(readonly originalCause: unknown, readonly stage: string, readonly reportId?: string) {
      super(originalCause instanceof Error ? originalCause.message : "COMPANY_RESEARCH_FAILED");
    }
  },
  defaultCompanyResearchRequest: vi.fn((companyName: string) => `Research ${companyName}`),
  publishCompanyResearchRun: vi.fn(),
  startCompanyResearchRun: vi.fn(),
}));

import { POST as startCompanyReport } from "@/app/api/company-reports/route";
import { POST as publishCompanyReport } from "@/app/api/company-reports/[reportId]/publish/route";
import { getCurrentUser } from "@/lib/auth";
import { defaultCompanyResearchRequest, publishCompanyResearchRun, startCompanyResearchRun } from "@/lib/analysis/company-research-run";
import { getCompanyResearchReport, getReport } from "@/lib/db/repository";
import { getYcCompaniesByIds } from "@/lib/yc/companies";

const sourceReportId = "9f9e61ee-8569-4c9a-bcab-11fcd5f4278b";
const companyReportId = "5d8f157e-802b-4b51-8f9c-4943863c0dc9";
const owner = { id: "owner", email: "owner@example.com", name: "Owner", roles: [] };
const map = {
  mode: "semantic" as const,
  algorithm: "umap" as const,
  seed: 42,
  modelWeight: 0.7,
  webWeight: 0.3,
  embeddingModel: "test-embedding",
  modelVersion: "browser-fit-v2",
  datasetVersion: "yc-2026",
  warning: null,
  points: [{ companyId: 42, x: 0.4, y: 0.6, target: true, textSource: "firecrawl" as const }],
};

describe("direct company report routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication before starting public research", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await startCompanyReport(new Request("https://example.test/api/company-reports", {
      method: "POST",
      body: JSON.stringify({ sourceReportId, companyId: 42 }),
    }));
    expect(response.status).toBe(401);
    expect(startCompanyResearchRun).not.toHaveBeenCalled();
  });

  it("starts a one-company report through the source report's owned conversation", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    vi.mocked(getReport).mockResolvedValue({ status: "complete", chatId: "chat-1" } as never);
    vi.mocked(getYcCompaniesByIds).mockResolvedValue([{ id: 42, name: "Acme" }] as never);
    vi.mocked(startCompanyResearchRun).mockResolvedValue({ reportId: companyReportId, runId: "workflow-run-1" } as never);

    const response = await startCompanyReport(new Request("https://example.test/api/company-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceReportId, companyId: 42 }),
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      reportId: companyReportId,
      href: `/company-reports/${companyReportId}`,
      status: "researching",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getReport).toHaveBeenCalledWith("owner", sourceReportId);
    expect(defaultCompanyResearchRequest).toHaveBeenCalledWith("Acme");
    expect(startCompanyResearchRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner",
      chatId: "chat-1",
      companyIds: [42],
      request: "Research Acme",
    }));
  });

  it("does not start from another user's or incomplete source report", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    vi.mocked(getReport).mockResolvedValue(null as never);
    const response = await startCompanyReport(new Request("https://example.test/api/company-reports", {
      method: "POST",
      body: JSON.stringify({ sourceReportId, companyId: 42 }),
    }));
    expect(response.status).toBe(404);
    expect(startCompanyResearchRun).not.toHaveBeenCalled();
  });

  it("publishes the browser map only for the owner's mapping report", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    vi.mocked(getCompanyResearchReport).mockResolvedValue({ status: "mapping", chatId: "chat-1" } as never);
    vi.mocked(publishCompanyResearchRun).mockResolvedValue({ href: `/company-reports/${companyReportId}`, document: {} } as never);

    const response = await publishCompanyReport(new Request(`https://example.test/api/company-reports/${companyReportId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ map }),
    }), { params: Promise.resolve({ reportId: companyReportId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ href: `/company-reports/${companyReportId}` });
    expect(publishCompanyResearchRun).toHaveBeenCalledWith({ userId: "owner", chatId: "chat-1", reportId: companyReportId, map });
  });
});
