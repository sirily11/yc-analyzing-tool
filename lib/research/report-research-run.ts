import "server-only";

import { start } from "workflow/api";
import { appConfig } from "@/config";
import { failReport } from "@/lib/db/repository";
import type { ApplicationProfile, PredictionResult } from "@/lib/types/analysis";
import { applicationReportWorkflow } from "@/workflows/application-report";
import { researchLog } from "./log";

export async function startApplicationReportResearchRun(input: {
  reportId: string;
  userId: string;
  profile: ApplicationProfile;
  prediction: PredictionResult;
}) {
  let run;
  try {
    run = await start(applicationReportWorkflow, [input]);
  } catch (cause) {
    await failReport(input.reportId, input.userId, cause instanceof Error ? cause.message.slice(0, 120) : "WORKFLOW_START_FAILED");
    throw cause;
  }
  researchLog("info", "report.workflow.queued", { reportId: input.reportId, workflowRunId: run.runId });

  return {
    reportId: input.reportId,
    runId: run.runId,
    href: `/reports/${input.reportId}`,
    status: "researching" as const,
    researchedCompanies: [...new Set(input.prediction.nearestCompanyIds)].slice(0, appConfig.reportResearch.comparableCompanyLimit).length,
  };
}
