import "server-only";

import { createHash } from "node:crypto";
import { appConfig, hasFirecrawlConfig } from "@/config";
import { collectChatAnalysisTextForReport } from "@/lib/ai/chat-source";
import { draftResearchReport, type ResearchMaterial } from "@/lib/analysis/report-draft";
import { buildReportDocument } from "@/lib/analysis/report";
import {
  addReportResearchJobs,
  beginReportResearch,
  claimReportDrafting,
  completeReport,
  getReadyChatDocument,
  getReport,
  getReportById,
  getReportResearchJobByExternalId,
  listReportResearchJobs,
  loadMessages,
  markReportResearchJob,
  reclaimStaleReportDrafting,
  touchReportResearchJob,
} from "@/lib/db/repository";
import type { ReportResearchTarget } from "@/lib/db/schema";
import { readRetainedDocument } from "@/lib/storage/chat-documents";
import type { ApplicationProfile, ComparableResearchSource, ExtractedPdf, PredictionResult } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";
import { loadYcCompanies } from "@/lib/yc/companies";
import {
  getFirecrawlJob,
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
  return prediction.nearestCompanyIds.slice(0, appConfig.reportResearch.comparableCompanyLimit).flatMap((id) => {
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

export async function startReportResearch(input: {
  reportId: string;
  userId: string;
  profile: ApplicationProfile;
  prediction: PredictionResult;
  chatText?: string | null;
}) {
  researchLog("info", "report.research.started", { reportId: input.reportId });
  const begun = await beginReportResearch({ id: input.reportId, userId: input.userId, profile: input.profile, prediction: input.prediction });
  if (!begun) throw new Error("REPORT_NOT_RESEARCHABLE");
  const metering = await reportMetering(input.reportId, input.userId);
  if (!hasFirecrawlConfig) {
    researchLog("warn", "report.research.fallback", { reportId: input.reportId, reason: "FIRECRAWL_NOT_CONFIGURED" });
    await finalizeReportResearch(input.reportId, { force: true, chatText: input.chatText });
    return { reportId: input.reportId, href: `/reports/${input.reportId}`, status: "complete" as const, researchedCompanies: 0 };
  }

  const companies = selectedCompanies(input.prediction, await loadYcCompanies());
  researchLog("info", "report.research.comparables.selected", { reportId: input.reportId, companyCount: companies.length });
  const started = await Promise.all(companies.map(async (company) => {
    const [crawl, search] = await Promise.allSettled([
      startWebsiteCrawl(input.reportId, company),
      searchComparableSources(company, metering),
    ]);
    if (crawl.status === "rejected") researchLog("warn", "report.research.crawl.start_failed", { reportId: input.reportId, companyId: company.id, failureCode: researchErrorCode(crawl.reason) });
    if (search.status === "rejected") researchLog("warn", "report.research.search.failed", { reportId: input.reportId, companyId: company.id, failureCode: researchErrorCode(search.reason) });
    return {
      company,
      crawl: crawl.status === "fulfilled" ? crawl.value : null,
      related: search.status === "fulfilled" ? search.value : [],
    };
  }));

  const jobs: Parameters<typeof addReportResearchJobs>[0] = [];
  const relatedTargets: ReportResearchTarget[] = [];
  for (const item of started) {
    relatedTargets.push(ycTarget(item.company), ...item.related);
    if (item.crawl) jobs.push({
      reportId: input.reportId,
      kind: "crawl",
      comparableCompanyId: item.company.id,
      firecrawlJobId: item.crawl.firecrawlJobId,
      targets: [item.crawl.target],
    });
  }
  try {
    const batch = await startRelatedBatch(input.reportId, relatedTargets);
    if (batch) jobs.push({
      reportId: input.reportId,
      kind: "batch-scrape",
      firecrawlJobId: batch.firecrawlJobId,
      targets: batch.targets,
    });
  } catch (cause) {
    // Website crawls can still produce a useful partial report.
    researchLog("warn", "report.research.batch.start_failed", { reportId: input.reportId, failureCode: researchErrorCode(cause) });
  }
  await addReportResearchJobs(jobs);
  researchLog("info", "report.research.jobs.persisted", { reportId: input.reportId, jobCount: jobs.length, relatedTargetCount: relatedTargets.length });
  if (!jobs.length) await finalizeReportResearch(input.reportId, { force: true, chatText: input.chatText });
  return {
    reportId: input.reportId,
    href: `/reports/${input.reportId}`,
    status: jobs.length ? "researching" as const : "complete" as const,
    researchedCompanies: companies.length,
  };
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
    text = collectChatAnalysisTextForReport(await loadMessages(report.userId, report.chatId), report.id) ?? "";
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

export async function finalizeReportResearch(reportId: string, options: { force?: boolean; chatText?: string | null } = {}) {
  const current = await getReportById(reportId);
  if (!current || current.status === "complete" || current.status === "failed") return current?.status === "complete";
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
  await completeReport({ id: claimed.id, userId: claimed.userId, profile: claimed.profile, prediction: claimed.prediction, document });
  if (metering?.reservationId) await closeReservation({
    reservationId: metering.reservationId,
    userId: claimed.userId,
    success: true,
    scopeId: claimed.id,
    chargeReportFee: true,
  });
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

export async function reconcileReportResearch(userId: string, reportId: string) {
  const report = await getReport(userId, reportId);
  if (!report) return null;
  if (report.status === "researching") {
    const jobs = await listReportResearchJobs(reportId);
    const stale = jobs.filter((job) => job.status === "running" && (!job.lastCheckedAt || Date.now() - job.lastCheckedAt.getTime() >= statusPollIntervalMs));
    researchLog("info", "report.research.reconcile", { reportId, runningJobCount: jobs.filter((job) => job.status === "running").length, pollCount: stale.length });
    await Promise.all(stale.map(refreshRunningJob));
    const refreshed = await listReportResearchJobs(reportId);
    const deadlinePassed = Boolean(report.researchDeadlineAt && report.researchDeadlineAt.getTime() <= Date.now());
    if (deadlinePassed || (refreshed.length > 0 && refreshed.every((job) => job.status !== "running"))) await finalizeReportResearch(reportId, { force: deadlinePassed });
  } else if (report.status === "drafting" && Date.now() - report.updatedAt.getTime() >= 2 * 60 * 1_000) {
    await finalizeReportResearch(reportId, { force: true });
  }
  return reportResearchProgress(userId, reportId);
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

export async function handleFirecrawlCompletion(input: { jobId: string; type: string; error?: string }) {
  researchLog("info", "firecrawl.webhook.received", { firecrawlJobId: input.jobId, type: input.type });
  const job = await getReportResearchJobByExternalId(input.jobId);
  if (!job) {
    researchLog("warn", "firecrawl.webhook.ignored", { firecrawlJobId: input.jobId, reason: "UNKNOWN_JOB" });
    return false;
  }
  if (job.status !== "running") {
    researchLog("info", "firecrawl.webhook.ignored", { reportId: job.reportId, firecrawlJobId: input.jobId, reason: "JOB_ALREADY_TERMINAL", status: job.status });
    return true;
  }
  if (input.type.endsWith(".failed")) {
    try {
      const snapshot = await getFirecrawlJob(job.kind, job.firecrawlJobId, await reportMetering(job.reportId));
      await markReportResearchJob({ firecrawlJobId: input.jobId, status: "failed", creditsUsed: snapshot.creditsUsed, failureCode: input.error?.slice(0, 120) || "FIRECRAWL_JOB_FAILED" });
      researchLog("warn", "firecrawl.webhook.job_failed", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, creditsUsed: snapshot.creditsUsed });
    } catch (cause) {
      await markReportResearchJob({ firecrawlJobId: input.jobId, status: "failed", failureCode: input.error?.slice(0, 120) || "FIRECRAWL_JOB_FAILED" });
      researchLog("warn", "firecrawl.webhook.job_failed", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, failureCode: researchErrorCode(cause) });
    }
  } else if (input.type.endsWith(".completed")) {
    try {
      const snapshot = await getFirecrawlJob(job.kind, job.firecrawlJobId, await reportMetering(job.reportId));
      await markReportResearchJob({ firecrawlJobId: input.jobId, status: snapshot.status === "failed" ? "failed" : "complete", creditsUsed: snapshot.creditsUsed, failureCode: snapshot.status === "failed" ? "FIRECRAWL_JOB_FAILED" : null });
      researchLog(snapshot.status === "failed" ? "warn" : "info", "firecrawl.webhook.job_completed", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, status: snapshot.status, creditsUsed: snapshot.creditsUsed });
    } catch (cause) {
      researchLog("warn", "firecrawl.webhook.result_fetch_failed", { reportId: job.reportId, firecrawlJobId: input.jobId, kind: job.kind, failureCode: researchErrorCode(cause) });
      return true;
    }
  } else {
    return true;
  }
  const jobs = await listReportResearchJobs(job.reportId);
  if (jobs.every((item) => item.status !== "running")) await finalizeReportResearch(job.reportId);
  return true;
}
