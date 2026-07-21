import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("workflow", () => ({
  getWorkflowMetadata: vi.fn(() => ({ workflowRunId: "run-1" })),
  RetryableError: class RetryableError extends Error {},
  sleep: vi.fn(),
}));
vi.mock("@/lib/db/repository", () => ({ beginReportResearch: vi.fn(), failReport: vi.fn(), getReportById: vi.fn(), listReportResearchJobs: vi.fn() }));
vi.mock("@/lib/research/report-research", () => ({
  expireOutstandingReportResearchJobs: vi.fn(),
  finalizeReportResearch: vi.fn(),
  markPendingComparableSearchUsageForReview: vi.fn(),
  prepareReportResearchJobs: vi.fn(),
  pollOutstandingReportResearchJobs: vi.fn(),
  pollReportResearchJobs: vi.fn(),
  settleCompletedReportResearch: vi.fn(),
  startReportResearchJobs: vi.fn(),
}));

import { sleep } from "workflow";
import { beginReportResearch, failReport, getReportById, listReportResearchJobs } from "@/lib/db/repository";
import {
  expireOutstandingReportResearchJobs,
  finalizeReportResearch,
  prepareReportResearchJobs,
  pollOutstandingReportResearchJobs,
  pollReportResearchJobs,
  settleCompletedReportResearch,
  startReportResearchJobs,
} from "@/lib/research/report-research";
import {
  applicationReportWorkflow,
  finalizeApplicationReportStep,
  startApplicationReportResearchStep,
} from "@/workflows/application-report";

const input = {
  userId: "user-1",
  reportId: "report-1",
  profile: { companyName: "Acme" },
  prediction: { nearestCompanyIds: [42] },
} as never;
const prepared = {
  reportId: "report-1",
  existingJobCount: 0,
  providerConfigured: true,
  companies: [{ id: 42, name: "Peer" }],
  metering: null,
} as never;

describe("application report workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sleep).mockResolvedValue(undefined as never);
    vi.mocked(beginReportResearch).mockResolvedValue({ id: "report-1" });
    vi.mocked(prepareReportResearchJobs).mockResolvedValue(prepared);
    vi.mocked(listReportResearchJobs).mockResolvedValue([]);
    vi.mocked(pollOutstandingReportResearchJobs).mockResolvedValue({ reportId: "report-1", running: 0, complete: 5, failed: 0 });
  });

  it("durably polls until DB jobs are terminal, then drafts and settles", async () => {
    vi.mocked(startReportResearchJobs).mockResolvedValue({ reportId: "report-1", jobCount: 5 });
    vi.mocked(pollReportResearchJobs)
      .mockResolvedValueOnce({ reportId: "report-1", status: "researching", readyToDraft: false, deadlinePassed: false })
      .mockResolvedValueOnce({ reportId: "report-1", status: "researching", readyToDraft: true, deadlinePassed: true });
    vi.mocked(finalizeReportResearch).mockResolvedValue(true);
    vi.mocked(settleCompletedReportResearch).mockResolvedValue(true);

    await expect(applicationReportWorkflow(input)).resolves.toEqual({ reportId: "report-1", status: "complete" });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(finalizeReportResearch).toHaveBeenCalledWith("report-1", { force: true, settleReservation: false });
    expect(settleCompletedReportResearch).toHaveBeenCalledWith("report-1");
    expect(failReport).not.toHaveBeenCalled();
  });

  it("accepts an already-complete DB report as a redelivered success", async () => {
    vi.mocked(startReportResearchJobs).mockResolvedValue({ reportId: "report-1", jobCount: 5 });
    vi.mocked(pollReportResearchJobs).mockResolvedValue({ reportId: "report-1", status: "complete", readyToDraft: true, deadlinePassed: false });
    vi.mocked(settleCompletedReportResearch).mockResolvedValue(true);

    await expect(applicationReportWorkflow(input)).resolves.toEqual({ reportId: "report-1", status: "complete" });
    expect(finalizeReportResearch).not.toHaveBeenCalled();
    expect(failReport).not.toHaveBeenCalled();
  });

  it("persists a terminal failure when the non-idempotent launch step fails", async () => {
    vi.mocked(startReportResearchJobs).mockRejectedValue(new Error("FIRECRAWL_START_FAILED"));

    await expect(applicationReportWorkflow(input)).rejects.toThrow("FIRECRAWL_START_FAILED");
    expect(failReport).toHaveBeenCalledWith("report-1", "user-1", "FIRECRAWL_START_FAILED", "run-1");
  });

  it("waits for a signed started webhook to recover an ambiguously accepted launch", async () => {
    vi.mocked(startReportResearchJobs).mockRejectedValue(new Error("FIRECRAWL_START_RESPONSE_LOST"));
    vi.mocked(listReportResearchJobs).mockResolvedValue([{ id: "recovered-job" }] as never);
    vi.mocked(pollReportResearchJobs).mockResolvedValue({ reportId: "report-1", status: "researching", readyToDraft: true, deadlinePassed: false });
    vi.mocked(finalizeReportResearch).mockResolvedValue(true);
    vi.mocked(settleCompletedReportResearch).mockResolvedValue(true);

    await expect(applicationReportWorkflow(input)).resolves.toEqual({ reportId: "report-1", status: "complete" });
    expect(listReportResearchJobs).toHaveBeenCalledTimes(5);
    expect(failReport).not.toHaveBeenCalled();
  });

  it("deduplicates a second workflow that loses the DB ownership claim", async () => {
    vi.mocked(beginReportResearch).mockResolvedValue(undefined as never);
    vi.mocked(getReportById).mockResolvedValue({ userId: "user-1", status: "researching", researchWorkflowRunId: "run-other" } as never);

    await expect(applicationReportWorkflow(input)).resolves.toEqual({ reportId: "report-1", status: "deduplicated" });
    expect(startReportResearchJobs).not.toHaveBeenCalled();
    expect(failReport).not.toHaveBeenCalled();
  });

  it("asks Workflow to retry after the drafting lease when a prior attempt failed mid-draft", async () => {
    vi.mocked(finalizeReportResearch).mockResolvedValue(false);
    vi.mocked(getReportById).mockResolvedValue({ status: "drafting" } as never);

    await expect(finalizeApplicationReportStep(input)).rejects.toMatchObject({ message: "REPORT_DRAFTING_LEASE_HELD" });
  });

  it("keeps settlement pending while accepted provider jobs drain", async () => {
    vi.mocked(startReportResearchJobs).mockResolvedValue({ reportId: "report-1", jobCount: 5 });
    vi.mocked(pollReportResearchJobs).mockResolvedValue({ reportId: "report-1", status: "researching", readyToDraft: true, deadlinePassed: true });
    vi.mocked(finalizeReportResearch).mockResolvedValue(true);
    vi.mocked(pollOutstandingReportResearchJobs)
      .mockResolvedValueOnce({ reportId: "report-1", running: 1, complete: 4, failed: 0 })
      .mockResolvedValueOnce({ reportId: "report-1", running: 0, complete: 5, failed: 0 });
    vi.mocked(settleCompletedReportResearch).mockResolvedValue(true);

    await expect(applicationReportWorkflow(input)).resolves.toEqual({ reportId: "report-1", status: "complete" });
    expect(pollOutstandingReportResearchJobs).toHaveBeenCalledTimes(2);
    expect(expireOutstandingReportResearchJobs).not.toHaveBeenCalled();
    expect(vi.mocked(settleCompletedReportResearch).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(pollOutstandingReportResearchJobs).mock.invocationCallOrder.at(-1) ?? 0);
  });

  it("compensates cleanup failure without failing an already-published report", async () => {
    vi.mocked(startReportResearchJobs).mockResolvedValue({ reportId: "report-1", jobCount: 5 });
    vi.mocked(pollReportResearchJobs).mockResolvedValue({ reportId: "report-1", status: "researching", readyToDraft: true, deadlinePassed: true });
    vi.mocked(finalizeReportResearch).mockResolvedValue(true);
    vi.mocked(pollOutstandingReportResearchJobs).mockRejectedValue(new Error("STATUS_DB_UNAVAILABLE"));
    vi.mocked(expireOutstandingReportResearchJobs).mockResolvedValue(2);
    vi.mocked(settleCompletedReportResearch).mockResolvedValue(true);

    await expect(applicationReportWorkflow(input)).resolves.toEqual({ reportId: "report-1", status: "complete", cleanup: "compensated" });
    expect(expireOutstandingReportResearchJobs).toHaveBeenCalledWith("report-1");
    expect(settleCompletedReportResearch).toHaveBeenCalledWith("report-1");
    expect(failReport).not.toHaveBeenCalled();
  });

  it("disables automatic replay for paid, non-idempotent Firecrawl launch", () => {
    expect((startApplicationReportResearchStep as typeof startApplicationReportResearchStep & { maxRetries?: number }).maxRetries).toBe(0);
  });
});
