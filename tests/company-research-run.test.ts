import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({ start: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({
  completeCompanyResearchReport: vi.fn(),
  createCompanyResearchReport: vi.fn(),
  failCompanyResearchReport: vi.fn(),
  getCompanyResearchReport: vi.fn(),
}));
vi.mock("@/lib/yc/companies", () => ({ getYcCompaniesByIds: vi.fn() }));
vi.mock("@/workflows/company-research", () => ({ companyResearchWorkflow: vi.fn() }));

import { start } from "workflow/api";
import { startCompanyResearchRun } from "@/lib/analysis/company-research-run";
import { createCompanyResearchReport, failCompanyResearchReport } from "@/lib/db/repository";
import { getYcCompaniesByIds } from "@/lib/yc/companies";
import { companyResearchWorkflow } from "@/workflows/company-research";

describe("company research workflow enqueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates one owned report and returns after scheduling the durable workflow", async () => {
    vi.mocked(getYcCompaniesByIds).mockResolvedValue([{ id: 42 }, { id: 7 }] as never);
    vi.mocked(createCompanyResearchReport).mockResolvedValue("report-1");
    vi.mocked(start).mockResolvedValue({ runId: "run-1" } as never);

    const result = await startCompanyResearchRun({
      userId: "user-1",
      chatId: "chat-1",
      companyIds: [42, 7, 42],
      request: "Compare both companies",
      requestId: "request-1",
    });

    expect(result).toEqual({ reportId: "report-1", runId: "run-1" });
    expect(createCompanyResearchReport).toHaveBeenCalledWith({
      userId: "user-1",
      chatId: "chat-1",
      companyIds: [42, 7],
      request: "Compare both companies",
    });
    expect(start).toHaveBeenCalledWith(companyResearchWorkflow, [{
      userId: "user-1",
      chatId: "chat-1",
      reportId: "report-1",
      companyIds: [42, 7],
      request: "Compare both companies",
      requestId: "request-1",
    }]);
  });

  it("marks the report failed when Workflow cannot be scheduled", async () => {
    vi.mocked(getYcCompaniesByIds).mockResolvedValue([{ id: 42 }] as never);
    vi.mocked(createCompanyResearchReport).mockResolvedValue("report-1");
    vi.mocked(start).mockRejectedValue(new Error("WORKFLOW_QUEUE_UNAVAILABLE"));

    await expect(startCompanyResearchRun({
      userId: "user-1",
      chatId: "chat-1",
      companyIds: [42],
      request: "Research this company",
    })).rejects.toMatchObject({ stage: "workflow_start", reportId: "report-1" });
    expect(failCompanyResearchReport).toHaveBeenCalledWith("report-1", "user-1", "WORKFLOW_QUEUE_UNAVAILABLE");
  });
});
