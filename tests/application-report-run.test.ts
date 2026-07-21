import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({ start: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ failReport: vi.fn() }));
vi.mock("@/workflows/application-report", () => ({ applicationReportWorkflow: vi.fn() }));

import { start } from "workflow/api";
import { failReport } from "@/lib/db/repository";
import { startApplicationReportResearchRun } from "@/lib/research/report-research-run";
import { applicationReportWorkflow } from "@/workflows/application-report";

const input = {
  reportId: "report-1",
  userId: "user-1",
  profile: { companyName: "Acme" },
  prediction: {
    nearestCompanyIds: [11, 12, 11, 13, 14, 15, 16],
  },
} as never;

describe("application report workflow enqueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues the durable run before returning the progress link", async () => {
    vi.mocked(start).mockResolvedValue({ runId: "run-1" } as never);

    await expect(startApplicationReportResearchRun(input)).resolves.toMatchObject({
      reportId: "report-1",
      runId: "run-1",
      status: "researching",
      researchedCompanies: 5,
    });

    expect(start).toHaveBeenCalledWith(applicationReportWorkflow, [input]);
  });

  it("marks the report failed when Workflow cannot be scheduled", async () => {
    vi.mocked(start).mockRejectedValue(new Error("WORKFLOW_QUEUE_UNAVAILABLE"));

    await expect(startApplicationReportResearchRun(input)).rejects.toThrow("WORKFLOW_QUEUE_UNAVAILABLE");
    expect(failReport).toHaveBeenCalledWith("report-1", "user-1", "WORKFLOW_QUEUE_UNAVAILABLE");
  });
});
