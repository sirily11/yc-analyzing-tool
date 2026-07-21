import "server-only";

import { createHash } from "node:crypto";
import { appConfig, hasFirecrawlConfig } from "@/config";
import { collectChatAnalysisText, collectChatAnalysisTextForReport } from "@/lib/ai/chat-source";
import { draftResearchReport, type ResearchMaterial } from "@/lib/analysis/report-draft";
import { buildReportDocument } from "@/lib/analysis/report";
import {
  addReportResearchJobs,
  claimReportDrafting,
  completeReport,
  failRunningReportResearchJobs,
  getReadyChatDocument,
  getReport,
  getReportById,
  getReportResearchJobByExternalId,
  listReportResearchJobs,
  loadMessages,
  markReportResearchJob,
  recordExpiredReportResearchJobUsage,
  reclaimStaleReportDrafting,
  touchReportResearchJob,
} from "@/lib/db/repository";
import type { ReportResearchTarget } from "@/lib/db/schema";
import { readRetainedDocument } from "@/lib/storage/chat-documents";
import type { ComparableResearchSource, ExtractedPdf, PredictionResult } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";
import { loadYcCompanies } from "@/lib/yc/companies";
import {
  getFirecrawlJob,
  FirecrawlLaunchAmbiguousError,
  FirecrawlUsagePersistenceError,
  hasFirecrawlWebhookConfig,
  markComparableSearchUsageForReview,
  prepareComparableSearchUsage,
  publicHttpsUrl,
  searchComparableSources,
  startRelatedBatch,
  startWebsiteCrawl,
  type FirecrawlDocument,
} from "./firecrawl";
import { researchErrorCode, researchLog } from "./log";
import { closeReservation, findOpenReservationByScope } from "@/lib/billing/repository";
import type { MeteringContext } from "@/lib/billing/usage";

const statusPollIntervalMs = 10_000;

async function reportMetering(reportId: string, userId?: string): Promise<MeteringContext | undefined> {
  const ownerId = userId ?? (await getReportById(reportId))?.userId;
  if (!ownerId) return undefined;
  const reservation = await findOpenReservationByScope(ownerId, reportId);
  return {
    userId: ownerId,
    reservationId: reservation?.id ?? null,
    feature: "Application report research",
    operationId: reportId,
  };
}

function selectedCompanies(prediction: PredictionResult, companies: YcCompany[]) {
  const lookup = new Map(companies.map((company) => [company.id, company]));
  return [...new Set(prediction.nearestCompanyIds)].slice(0, appConfig.reportResearch.comparableCompanyLimit).flatMap((id) => {
    const company = lookup.get(id);
    return company ? [company] : [];
  });
}

function ycTarget(company: YcCompany): ReportResearchTarget {
  return {
    companyId: company.id,
    url: `https://www.ycombinator.com/companies/${encodeURIComponent(company.slug)}`,
    sourceType: "yc-profile",
  };
}

export type PreparedReportResearchJobs = {
  reportId: string;
  existingJobCount: number;
  providerConfigured: boolean;
  companies: YcCompany[];
  metering: MeteringContext | null;
};

export async function prepareReportResearchJobs(reportId: string): Promise<PreparedReportResearchJobs> {
  const report = await getReportById(reportId);
  if (!report || report.status !== "researching" || !report.profile || !report.prediction) throw new Error("REPORT_NOT_RESEARCHABLE");
  const existingJobs = await listReportResearchJobs(reportId);
  if (existingJobs.length) {
    researchLog("info", "report.research.jobs_reused", { reportId, jobCount: existingJobs.length });
    return { reportId, existingJobCount: existingJobs.length, providerConfigured: hasFirecrawlConfig, companies: [], metering: null };
  }

  const providerConfigured = hasFirecrawlConfig && hasFirecrawlWebhookConfig();
  if (!providerConfigured) {
    researchLog("warn", "report.research.fallback", { reportId, reason: hasFirecrawlConfig ? "FIRECRAWL_DURABLE_WEBHOOK_NOT_CONFIGURED" : "FIRECRAWL_NOT_CONFIGURED" });
    return { reportId, existingJobCount: 0, providerConfigured: false, companies: [], metering: null };
  }

  const companies = selectedCompanies(report.prediction, await loadYcCompanies());
  const metering = await reportMetering(reportId, report.userId) ?? null;
  await prepareComparableSearchUsage(companies, metering ?? undefined);
  researchLog("info", "report.research.comparables.selected", { reportId, companyCount: companies.length });
  return { reportId, existingJobCount: 0, providerConfigured: true, companies, metering };
}

export async function markPendingComparableSearchUsageForReview(reportId: string, prediction: PredictionResult) {
  const companyIds = [...new Set(prediction.nearestCompanyIds)].slice(0, appConfig.reportResearch.comparableCompanyLimit);
  await markComparableSearchUsageForReview(companyIds, await reportMetering(reportId));
}

export async function startReportResearchJobs(prepared: PreparedReportResearchJobs) {
  const { reportId } = prepared;
  if (prepared.existingJobCount || !prepared.providerConfigured) return { reportId, jobCount: prepared.existingJobCount };

  researchLog("info", "report.research.started", { reportId });
  const started = await Promise.all(prepared.companies.map(async (company) => {
    const [crawl, search] = await Promise.allSettled([
      startWebsiteCrawl(reportId, company),
      searchComparableSources(company, prepared.metering ?? undefined),
    ]);
    if (crawl.status === "rejected") researchLog("warn", "report.research.crawl.start_failed", { reportId, companyId: company.id, failureCode: researchErrorCode(crawl.reason) });
    if (search.status === "rejected") researchLog("warn", "report.research.search.failed", { reportId, companyId: company.id, failureCode: researchErrorCode(search.reason) });
    if (crawl.status === "rejected" && crawl.reason instanceof FirecrawlLaunchAmbiguousError) throw crawl.reason;
    if (search.status === "rejected" && search.reason instanceof FirecrawlUsagePersistenceError) throw search.reason;
    if (crawl.status === "fulfilled" && crawl.value) {
      await addReportResearchJobs([{
        reportId,
        kind: "crawl",
        comparableCompanyId: company.id,
        firecrawlJobId: crawl.value.firecrawlJobId,
        targets: [crawl.value.target],
      }]);
    }
    return {
      company,
      related: search.status === "fulfilled" ? search.value : [],
    };
  }));

  const relatedTargets: ReportResearchTarget[] = [];
  for (const item of started) {
    relatedTargets.push(ycTarget(item.company), ...item.related);
  }
  let batch = null;
  try {
    batch = await startRelatedBatch(reportId, relatedTargets);
  } catch (cause) {
    if (cause instanceof FirecrawlLaunchAmbiguousError) throw cause;
    // Website crawls can still produce a useful partial report.
    researchLog("warn", "report.research.batch.start_failed", { reportId, failureCode: researchErrorCode(cause) });
  }
  if (batch) await addReportResearchJobs([{
    reportId,
    kind: "batch-scrape",
    firecrawlJobId: batch.firecrawlJobId,
    targets: batch.targets,
  }]);
  const jobs = await listReportResearchJobs(reportId);
  researchLog("info", "report.research.jobs.persisted", { reportId, jobCount: jobs.length, relatedTargetCount: relatedTargets.length });
  return { reportId, jobCount: jobs.length };
}

function normalizedUrl(value: string | undefined) {
  const url = publicHttpsUrl(value);
  return url?.replace(/\/$/, "") ?? null;
}

function targetForDocument(targets: ReportResearchTarget[], document: FirecrawlDocument) {
  const sourceUrl = normalizedUrl(document.metadata.sourceURL ?? document.metadata.url);
  if (!sourceUrl) return null;
  return targets.find((target) => normalizedUrl(target.url) === sourceUrl) ?? null;
}

function publishedAt(document: FirecrawlDocument) {
  const value = document.metadata.publishedTime ?? document.metadata.publishedDate;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function collectResearchMaterials(reportId: string) {
  const jobs = await listReportResearchJobs(reportId);
  const metering = await reportMetering(reportId);
  const warnings: string[] = jobs.filter((job) => job.status === "failed").map((job) => `A ${job.kind} research job did not complete.`);
  const snapshots = await Promise.all(jobs.filter((job) => job.status === "complete").map(async (job) => {
    try {
      return { job, snapshot: await getFirecrawlJob(job.kind, job.firecrawlJobId, metering) };
    } catch (cause) {
      warnings.push(`Completed ${job.kind} results could not be retrieved.`);
      researchLog("warn", "report.research.results.unavailable", { reportId, firecrawlJobId: job.firecrawlJobId, kind: job.kind, failureCode: researchErrorCode(cause) });
      return null;
    }
  }));
  const rows: Array<{ target: ReportResearchTarget; document: FirecrawlDocument }> = [];
  for (const result of snapshots) {
    if (!result) continue;
    for (const document of result.snapshot.documents) {
      const target = result.job.kind === "crawl" ? result.job.targets[0] : targetForDocument(result.job.targets, document);
      if (target) rows.push({ target, document });
    }
  }
  const deduped = [...new Map(rows.flatMap((row) => {
    const url = publicHttpsUrl(row.document.metadata.sourceURL ?? row.document.metadata.url ?? row.target.url);
    return url ? [[url.replace(/\/$/, ""), { ...row, url }]] : [];
  })).values()].sort((left, right) => left.target.companyId - right.target.companyId || left.url.localeCompare(right.url));
  const accessedAt = new Date().toISOString();
  const sources: ComparableResearchSource[] = [];
  const materials: ResearchMaterial[] = [];
  deduped.forEach((row, index) => {
    const source: ComparableResearchSource = {
      id: `S${String(index + 1).padStart(2, "0")}`,
      companyId: row.target.companyId,
      title: row.document.metadata.title?.trim() || new URL(row.url).hostname,
      url: row.url,
      sourceType: row.target.sourceType,
      publishedAt: publishedAt(row.document),
      accessedAt,
    };
    sources.push(source);
    materials.push({ source, content: row.document.markdown });
  });
  researchLog("info", "report.research.materials.collected", {
    reportId,
    completedJobCount: jobs.filter((job) => job.status === "complete").length,
    failedJobCount: jobs.filter((job) => job.status === "failed").length,
    sourceCount: sources.length,
    warningCount: warnings.length,
  });
  return { sources, materials, warnings };
}

async function candidateSource(report: NonNullable<Awaited<ReturnType<typeof getReportById>>>, chatText?: string | null): Promise<ExtractedPdf> {
  if (report.sourceFile.kind !== "chat" && report.sourceDocumentId) {
    const document = await getReadyChatDocument(report.userId, report.chatId, report.sourceDocumentId);
    if (document) return readRetainedDocument(document);
  }
  let text = chatText?.trim() || "";
  if (!text && report.sourceFile.kind === "chat") {
    const messages = await loadMessages(report.userId, report.chatId);
    text = collectChatAnalysisTextForReport(messages, report.id) ?? collectChatAnalysisText(messages) ?? "";
  }
  if (!text) text = report.profile?.summary ?? "The approved source could not be reconstructed.";
  return {
    metadata: report.sourceFile.kind === "chat" ? report.sourceFile : { ...report.sourceFile, kind: "chat", pages: 1, characters: text.length, size: new TextEncoder().encode(text).byteLength, sha256: createHash("sha256").update(text).digest("hex") },
    pages: [{ page: 1, text }],
    text,
  };
}

function researchCoverage(companies: YcCompany[], sources: ComparableResearchSource[]) {
  const covered = new Set(sources.map((source) => source.companyId));
  if (!sources.length) return "unavailable" as const;
  return companies.every((company) => covered.has(company.id)) ? "complete" as const : "partial" as const;
}

export async function settleCompletedReportResearch(reportId: string) {
  const report = await getReportById(reportId);
  if (!report || report.status !== "complete") return false;
  const reservation = await findOpenReservationByScope(report.userId, reportId);
  if (reservation) await closeReservation({
    reservationId: reservation.id,
    userId: report.userId,
    success: true,
    scopeId: reportId,
    chargeReportFee: true,
  });
  return true;
}

export async function finalizeReportResearch(reportId: string, options: { force?: boolean; chatText?: string | null; settleReservation?: boolean } = {}) {
  const current = await getReportById(reportId);
  if (!current || current.status === "failed") return false;
  if (current.status === "complete") {
    if (options.settleReservation !== false) await settleCompletedReportResearch(reportId);
    return true;
  }
  const jobs = await listReportResearchJobs(reportId);
  const deadlinePassed = Boolean(current.researchDeadlineAt && current.researchDeadlineAt.getTime() <= Date.now());
  let claimed;
  if (current.status === "drafting") {
    claimed = await reclaimStaleReportDrafting(reportId, new Date(Date.now() - 2 * 60 * 1_000));
  } else if (current.status === "researching") {
    if (!options.force && !deadlinePassed && jobs.some((job) => job.status === "running")) {
      researchLog("info", "report.drafting.deferred", { reportId, runningJobCount: jobs.filter((job) => job.status === "running").length });
      return false;
    }
    claimed = await claimReportDrafting(reportId);
  } else {
    return false;
  }
  if (!claimed?.profile || !claimed.prediction) {
    researchLog("warn", "report.drafting.claim_skipped", { reportId, status: current.status });
    return false;
  }
  researchLog("info", "report.drafting.started", { reportId, forced: Boolean(options.force), deadlinePassed });

  const companies = await loadYcCompanies();
  const comparables = selectedCompanies(claimed.prediction, companies);
  const research = await collectResearchMaterials(reportId);
  const coverage = researchCoverage(comparables, research.sources);
  if (coverage !== "complete") research.warnings.push(coverage === "unavailable" ? "External comparable-company research was unavailable; the dossier uses the public YC dataset and approved source." : "Some comparable-company sources were unavailable; cited findings use only completed research.");
  let draft = null;
  const metering = await reportMetering(reportId, claimed.userId);
  try {
    draft = await draftResearchReport({
      source: await candidateSource(claimed, options.chatText),
      profile: claimed.profile,
      prediction: claimed.prediction,
      companies: comparables,
      researchSources: research.sources,
      materials: research.materials,
    }, metering ? { ...metering, feature: "Application report drafting" } : undefined);
    if (draft) {
      researchLog("info", "report.drafting.model_completed", { reportId, model: appConfig.reportModel, usedModelDraft: true });
    } else {
      research.warnings.push("The dedicated drafting model was not configured or returned no valid draft; deterministic coaching guidance was used.");
      researchLog("warn", "report.drafting.model_fallback", { reportId, model: appConfig.reportModel, failureCode: "MODEL_NOT_CONFIGURED_OR_EMPTY" });
    }
  } catch (cause) {
    research.warnings.push("The dedicated drafting model was unavailable; deterministic coaching guidance was used.");
    researchLog("warn", "report.drafting.model_fallback", { reportId, model: appConfig.reportModel, failureCode: researchErrorCode(cause) });
  }
  const document = buildReportDocument(claimed.profile, claimed.prediction, companies, {
    draft: draft ?? undefined,
    researchSources: research.sources.length ? research.sources : undefined,
    researchWarnings: research.warnings,
    researchStatus: coverage,
    draftModel: appConfig.reportModel,
  });
  const completed = await completeReport({ id: claimed.id, userId: claimed.userId, profile: claimed.profile, prediction: claimed.prediction, document });
  if (!completed && (await getReportById(reportId))?.status !== "complete") return false;
  if (options.settleReservation !== false) await settleCompletedReportResearch(reportId);
  researchLog("info", "report.drafting.completed", { reportId, researchCoverage: coverage, sourceCount: research.sources.length, warningCount: research.warnings.length, usedModelDraft: Boolean(draft) });
  return true;
}

async function refreshRunningJob(job: Awaited<ReturnType<typeof listReportResearchJobs>>[number]) {
  try {
    await touchReportResearchJob(job.firecrawlJobId);
    const snapshot = await getFirecrawlJob(job.kind, job.firecrawlJobId, await reportMetering(job.reportId));
    if (snapshot.status === "completed" || snapshot.status === "failed") {
      await markReportResearchJob({
        firecrawlJobId: job.firecrawlJobId,
        status: snapshot.status === "completed" ? "complete" : "failed",
        creditsUsed: snapshot.creditsUsed,
        failureCode: snapshot.status === "failed" ? "FIRECRAWL_JOB_FAILED" : null,
      });
      researchLog(snapshot.status === "completed" ? "info" : "warn", "report.research.job.terminal", {
        reportId: job.reportId,
        firecrawlJobId: job.firecrawlJobId,
        kind: job.kind,
        status: snapshot.status,
        creditsUsed: snapshot.creditsUsed,
      });
    }
  } catch (cause) {
    // A later webhook or poll can recover a transient status failure.
    researchLog("warn", "report.research.job.poll_failed", { reportId: job.reportId, firecrawlJobId: job.firecrawlJobId, kind: job.kind, failureCode: researchErrorCode(cause) });
  }
}

async function refreshReportResearchJobs(reportId: string) {
  const jobs = await listReportResearchJobs(reportId);
  const stale = jobs.filter((job) => job.status === "running" && (!job.lastCheckedAt || Date.now() - job.lastCheckedAt.getTime() >= statusPollIntervalMs));
  researchLog("info", "report.research.reconcile", { reportId, runningJobCount: jobs.filter((job) => job.status === "running").length, pollCount: stale.length });
  await Promise.all(stale.map(refreshRunningJob));
  return listReportResearchJobs(reportId);
}

export async function pollReportResearchJobs(reportId: string) {
  const report = await getReportById(reportId);
  if (!report) return null;
  if (report.status !== "researching") {
    return { reportId, status: report.status, readyToDraft: report.status === "drafting" || report.status === "complete", deadlinePassed: false };
  }

  const refreshed = await refreshReportResearchJobs(reportId);
  const deadlinePassed = Boolean(report.researchDeadlineAt && report.researchDeadlineAt.getTime() <= Date.now());
  return {
    reportId,
    status: report.status,
    readyToDraft: deadlinePassed || refreshed.length === 0 || refreshed.every((job) => job.status !== "running"),
    deadlinePassed,
  };
}

export async function pollOutstandingReportResearchJobs(reportId: string) {
  const jobs = await refreshReportResearchJobs(reportId);
  return {
    reportId,
    running: jobs.filter((job) => job.status === "running").length,
    complete: jobs.filter((job) => job.status === "complete").length,
    failed: jobs.filter((job) => job.status === "failed").length,
  };
}

export async function expireOutstandingReportResearchJobs(reportId: string) {
  const failed = await failRunningReportResearchJobs(reportId, "RESEARCH_CLEANUP_DEADLINE_EXCEEDED");
  if (failed.length) researchLog("warn", "report.research.cleanup_deadline_reached", { reportId, failedJobCount: failed.length });
  return failed.length;
}

export async function reportResearchProgress(userId: string, reportId: string) {
  const report = await getReport(userId, reportId);
  if (!report) return null;
  const jobs = await listReportResearchJobs(reportId);
  return {
    reportId,
    status: report.status,
    jobs: {
      total: jobs.length,
      running: jobs.filter((job) => job.status === "running").length,
      complete: jobs.filter((job) => job.status === "complete").length,
      failed: jobs.filter((job) => job.status === "failed").length,
    },
    deadlineAt: report.researchDeadlineAt?.toISOString() ?? null,
    href: `/reports/${reportId}`,
  };
}

async function finishReportAfterTerminalResearchJobs(reportId: string) {
  const [jobs, report] = await Promise.all([
    listReportResearchJobs(reportId),
    getReportById(reportId),
  ]);
  if (!report || jobs.some((item) => item.status === "running")) return;
  if (report.status === "complete") {
    await settleCompletedReportResearch(reportId);
    return;
  }
  // Reports created before the Workflow migration have no run marker. Keep
  // their signed callback completion path until those in-flight rows drain.
  if (!report.researchWorkflowRunId) await finalizeReportResearch(reportId);
}

export async function handleFirecrawlCompletion(input: {
  jobId: string;
  type: string;
  error?: string;
  metadata?: { reportId: string; kind: "crawl" | "batch-scrape"; comparableCompanyId?: number; targets: ReportResearchTarget[] };
}) {
  researchLog("info", "firecrawl.webhook.received", { firecrawlJobId: input.jobId, type: input.type });
  let job = await getReportResearchJobByExternalId(input.jobId);
  if (!job && input.metadata && await getReportById(input.metadata.reportId)) {
    await addReportResearchJobs([{
      reportId: input.metadata.reportId,
      kind: input.metadata.kind,
      comparableCompanyId: input.metadata.comparableCompanyId,
      firecrawlJobId: input.jobId,
      targets: input.metadata.targets,
    }]);
    job = await getReportResearchJobByExternalId(input.jobId);
    if (!job) throw new Error("FIRECRAWL_WEBHOOK_JOB_NOT_DURABLE");
    if (job) researchLog("warn", "firecrawl.webhook.job_recovered", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind });
  }
  if (!job) {
    researchLog("warn", "firecrawl.webhook.ignored", { firecrawlJobId: input.jobId, reason: "UNKNOWN_JOB" });
    return false;
  }
  if (job.status !== "running") {
    if (job.status === "failed" && job.failureCode === "RESEARCH_CLEANUP_DEADLINE_EXCEEDED" && /\.(?:completed|failed)$/.test(input.type)) {
      try {
        const snapshot = await getFirecrawlJob(job.kind, job.firecrawlJobId, await reportMetering(job.reportId));
        await recordExpiredReportResearchJobUsage(job.firecrawlJobId, snapshot.creditsUsed);
        researchLog("info", "firecrawl.webhook.late_usage_recorded", { reportId: job.reportId, firecrawlJobId: input.jobId, creditsUsed: snapshot.creditsUsed });
      } catch (cause) {
        researchLog("warn", "firecrawl.webhook.late_usage_failed", { reportId: job.reportId, firecrawlJobId: input.jobId, failureCode: researchErrorCode(cause) });
        throw cause;
      }
      await finishReportAfterTerminalResearchJobs(job.reportId);
      return true;
    }
    researchLog("info", "firecrawl.webhook.ignored", { reportId: job.reportId, firecrawlJobId: input.jobId, reason: "JOB_ALREADY_TERMINAL", status: job.status });
    await finishReportAfterTerminalResearchJobs(job.reportId);
    return true;
  }
  if (input.type.endsWith(".failed")) {
    try {
      const snapshot = await getFirecrawlJob(job.kind, job.firecrawlJobId, await reportMetering(job.reportId));
      if (snapshot.status === "scraping") throw new Error("FIRECRAWL_TERMINAL_STATUS_PENDING");
      const status = snapshot.status === "completed" ? "complete" : "failed";
      await markReportResearchJob({ firecrawlJobId: input.jobId, status, creditsUsed: snapshot.creditsUsed, failureCode: status === "failed" ? input.error?.slice(0, 120) || "FIRECRAWL_JOB_FAILED" : null });
      researchLog(status === "complete" ? "info" : "warn", "firecrawl.webhook.job_failed", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, status: snapshot.status, creditsUsed: snapshot.creditsUsed });
    } catch (cause) {
      researchLog("warn", "firecrawl.webhook.job_failed_retryable", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, failureCode: researchErrorCode(cause) });
      throw cause;
    }
  } else if (input.type.endsWith(".completed")) {
    try {
      const snapshot = await getFirecrawlJob(job.kind, job.firecrawlJobId, await reportMetering(job.reportId));
      if (snapshot.status === "scraping") throw new Error("FIRECRAWL_TERMINAL_STATUS_PENDING");
      await markReportResearchJob({ firecrawlJobId: input.jobId, status: snapshot.status === "failed" ? "failed" : "complete", creditsUsed: snapshot.creditsUsed, failureCode: snapshot.status === "failed" ? "FIRECRAWL_JOB_FAILED" : null });
      researchLog(snapshot.status === "failed" ? "warn" : "info", "firecrawl.webhook.job_completed", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, status: snapshot.status, creditsUsed: snapshot.creditsUsed });
    } catch (cause) {
      researchLog("warn", "firecrawl.webhook.result_fetch_failed", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, failureCode: researchErrorCode(cause) });
      throw cause;
    }
  } else {
    return true;
  }
  await finishReportAfterTerminalResearchJobs(job.reportId);
  return true;
}
