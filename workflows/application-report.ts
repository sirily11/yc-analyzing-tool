import { getWorkflowMetadata, RetryableError, sleep } from "workflow";
import { beginReportResearch, failReport, getReportById, listReportResearchJobs } from "@/lib/db/repository";
import type { ApplicationProfile, PredictionResult } from "@/lib/types/analysis";
import {
  expireOutstandingReportResearchJobs,
  finalizeReportResearch,
  markPendingComparableSearchUsageForReview,
  prepareReportResearchJobs,
  pollOutstandingReportResearchJobs,
  pollReportResearchJobs,
  settleCompletedReportResearch,
  startReportResearchJobs,
  type PreparedReportResearchJobs,
} from "@/lib/research/report-research";

export type ApplicationReportWorkflowInput = {
  userId: string;
  reportId: string;
  profile: ApplicationProfile;
  prediction: PredictionResult;
};

export async function claimApplicationReportStep(input: ApplicationReportWorkflowInput, workflowRunId: string) {
  "use step";
  const claimed = await beginReportResearch({
    id: input.reportId,
    userId: input.userId,
    profile: input.profile,
    prediction: input.prediction,
    workflowRunId,
  });
  if (claimed) return true;
  const existing = await getReportById(input.reportId);
  return existing?.userId === input.userId
    && existing.researchWorkflowRunId === workflowRunId
    && existing.status !== "failed";
}

export async function prepareApplicationReportResearchStep(input: ApplicationReportWorkflowInput) {
  "use step";
  return prepareReportResearchJobs(input.reportId);
}

export async function startApplicationReportResearchStep(prepared: PreparedReportResearchJobs) {
  "use step";
  return startReportResearchJobs(prepared);
}

// Firecrawl job creation is a paid, non-idempotent provider side effect. The
// helper handles per-company provider failures, while Workflow must not replay
// the whole launch after an ambiguous step failure.
(startApplicationReportResearchStep as typeof startApplicationReportResearchStep & { maxRetries?: number }).maxRetries = 0;

export async function verifyApplicationReportLaunchStep(prepared: PreparedReportResearchJobs) {
  "use step";
  if (!prepared.providerConfigured || prepared.existingJobCount > 0) return true;
  return (await listReportResearchJobs(prepared.reportId)).length > 0;
}

export async function pollApplicationReportResearchStep(input: ApplicationReportWorkflowInput) {
  "use step";
  return pollReportResearchJobs(input.reportId);
}

export async function pollOutstandingApplicationReportResearchStep(input: ApplicationReportWorkflowInput) {
  "use step";
  return pollOutstandingReportResearchJobs(input.reportId);
}

export async function expireOutstandingApplicationReportResearchStep(input: ApplicationReportWorkflowInput) {
  "use step";
  return expireOutstandingReportResearchJobs(input.reportId);
}

export async function finalizeApplicationReportStep(input: ApplicationReportWorkflowInput) {
  "use step";
  const completed = await finalizeReportResearch(input.reportId, { force: true, settleReservation: false });
  if (completed) return;
  const report = await getReportById(input.reportId);
  if (report?.status === "drafting") {
    throw new RetryableError("REPORT_DRAFTING_LEASE_HELD", { retryAfter: "2m" });
  }
  throw new Error("REPORT_RESEARCH_NOT_FINALIZED");
}

export async function settleApplicationReportStep(input: ApplicationReportWorkflowInput) {
  "use step";
  if (!await settleCompletedReportResearch(input.reportId)) throw new Error("REPORT_RESEARCH_NOT_SETTLED");
}

export async function failApplicationReportStep(input: ApplicationReportWorkflowInput, workflowRunId: string, failureCode: string) {
  "use step";
  await markPendingComparableSearchUsageForReview(input.reportId, input.prediction);
  await failReport(input.reportId, input.userId, failureCode.slice(0, 120), workflowRunId);
}

export async function applicationReportWorkflow(input: ApplicationReportWorkflowInput) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  try {
    if (!await claimApplicationReportStep(input, workflowRunId)) {
      return { reportId: input.reportId, status: "deduplicated" as const };
    }

    const prepared = await prepareApplicationReportResearchStep(input);
    try {
      await startApplicationReportResearchStep(prepared);
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("FIRECRAWL_USAGE_NOT_DURABLE")) throw cause;
      // A launch response or its DB write can be lost after Firecrawl accepts
      // the paid job. Give signed `started` webhooks (including their first
      // retry) time to recover accepted IDs before declaring the run failed.
      let recovered = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await sleep("15s");
        recovered = await verifyApplicationReportLaunchStep(prepared) || recovered;
        if (recovered && attempt >= 4) break;
      }
      if (!recovered) throw cause;
    }

    let alreadyComplete = false;
    while (true) {
      await sleep("10s");
      const progress = await pollApplicationReportResearchStep(input);
      if (!progress) throw new Error("REPORT_NOT_FOUND");
      if (progress.status === "complete") {
        alreadyComplete = true;
        break;
      }
      if (progress.status === "failed") throw new Error("REPORT_RESEARCH_FAILED");
      if (progress.readyToDraft) break;
    }

    if (!alreadyComplete) await finalizeApplicationReportStep(input);

  } catch (cause) {
    const failureCode = cause instanceof Error ? cause.message : "REPORT_RESEARCH_FAILED";
    await failApplicationReportStep(input, workflowRunId, failureCode);
    throw cause;
  }

  // The user-facing report may publish at its bounded research deadline, but
  // the reservation stays open while accepted provider jobs finish so their
  // terminal credit usage is recorded before billing settles. Failures here
  // must never change an already-published report to failed.
  try {
    let outstanding = await pollOutstandingApplicationReportResearchStep(input);
    for (let attempt = 0; outstanding.running > 0 && attempt < 100; attempt += 1) {
      await sleep("30s");
      outstanding = await pollOutstandingApplicationReportResearchStep(input);
    }
    if (outstanding.running > 0) await expireOutstandingApplicationReportResearchStep(input);

    await settleApplicationReportStep(input);
    return { reportId: input.reportId, status: "complete" as const };
  } catch {
    // Each compensation step has Workflow's own retries. Expiring any remaining
    // local jobs makes the reservation closable; a late signed callback still
    // records its provider usage instead of leaving the reservation open.
    await expireOutstandingApplicationReportResearchStep(input);
    await settleApplicationReportStep(input);
    return { reportId: input.reportId, status: "complete" as const, cleanup: "compensated" as const };
  }
}
