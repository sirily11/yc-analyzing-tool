import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/company-research", () => ({ buildCompanyResearchDraft: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ failCompanyResearchReport: vi.fn(), getCompanyResearchReport: vi.fn(), storeCompanyResearchDraft: vi.fn() }));
vi.mock("@/lib/yc/companies", () => ({ getYcCompaniesByIds: vi.fn() }));

import { buildCompanyResearchDraft } from "@/lib/analysis/company-research";
import { failCompanyResearchReport, getCompanyResearchReport, storeCompanyResearchDraft } from "@/lib/db/repository";
import { getYcCompaniesByIds } from "@/lib/yc/companies";
import { companyResearchWorkflow } from "@/workflows/company-research";

const input = {
  userId: "user-1",
  chatId: "chat-1",
  reportId: "5d8f157e-802b-4b51-8f9c-4943863c0dc9",
  companyIds: [42],
  request: "Research Acme",
  requestId: "request-1",
};

describe("company research workflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a mapping-ready draft after the retryable research step", async () => {
    vi.mocked(getYcCompaniesByIds).mockResolvedValue([{ id: 42, name: "Acme" }] as never);
    vi.mocked(buildCompanyResearchDraft).mockResolvedValue({
      companies: [{ companyId: 42, semanticText: "Payments infrastructure" }],
      sources: [{ companyId: 42, kind: "official-site", status: "ok" }],
    } as never);
    vi.mocked(storeCompanyResearchDraft).mockResolvedValue({ id: input.reportId } as never);

    await expect(companyResearchWorkflow(input)).resolves.toEqual({ reportId: input.reportId, status: "mapping" });
    expect(storeCompanyResearchDraft).toHaveBeenCalledWith(expect.objectContaining({
      id: input.reportId,
      userId: "user-1",
      mapInput: {
        reportId: input.reportId,
        targets: [{ companyId: 42, semanticText: "Payments infrastructure", textSource: "firecrawl" }],
      },
    }));
    expect(failCompanyResearchReport).not.toHaveBeenCalled();
  });

  it("persists a terminal failed status when research exhausts its retries", async () => {
    vi.mocked(getYcCompaniesByIds).mockResolvedValue([{ id: 42, name: "Acme" }] as never);
    vi.mocked(buildCompanyResearchDraft).mockRejectedValue(new Error("FIRECRAWL_RESEARCH_UNAVAILABLE"));

    await expect(companyResearchWorkflow(input)).rejects.toThrow("FIRECRAWL_RESEARCH_UNAVAILABLE");
    expect(failCompanyResearchReport).toHaveBeenCalledWith(input.reportId, "user-1", "FIRECRAWL_RESEARCH_UNAVAILABLE");
  });

  it("treats an already stored mapping draft as a successful step retry", async () => {
    vi.mocked(getYcCompaniesByIds).mockResolvedValue([{ id: 42, name: "Acme" }] as never);
    vi.mocked(buildCompanyResearchDraft).mockResolvedValue({
      companies: [{ companyId: 42, semanticText: "Payments infrastructure" }],
      sources: [],
    } as never);
    vi.mocked(storeCompanyResearchDraft).mockResolvedValue(null as never);
    vi.mocked(getCompanyResearchReport).mockResolvedValue({ status: "mapping" } as never);

    await expect(companyResearchWorkflow(input)).resolves.toEqual({ reportId: input.reportId, status: "mapping" });
    expect(failCompanyResearchReport).not.toHaveBeenCalled();
  });
});
