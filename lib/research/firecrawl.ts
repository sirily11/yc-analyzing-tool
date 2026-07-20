import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { appConfig } from "@/config";
import { getMetadataBase } from "@/lib/site-metadata";
import type { ReportResearchTarget } from "@/lib/db/schema";
import type { YcCompany } from "@/lib/types/company";
import { researchErrorCode, researchLog } from "./log";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const excludedRelatedHosts = [
  "facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "twitter.com", "x.com",
  "crunchbase.com", "pitchbook.com", "rocketreach.co", "signalhire.com", "theorg.com", "tracxn.com", "zoominfo.com",
];

type FirecrawlSearchResult = {
  title?: string;
  description?: string;
  url?: string;
};

type FirecrawlJobStart = { success: boolean; id: string; url?: string };

export type FirecrawlDocument = {
  markdown: string;
  metadata: {
    title?: string;
    description?: string;
    sourceURL?: string;
    url?: string;
    publishedTime?: string;
    publishedDate?: string;
    statusCode?: number;
  };
};

export type FirecrawlJobSnapshot = {
  status: "scraping" | "completed" | "failed";
  completed: number;
  total: number;
  creditsUsed: number;
  documents: FirecrawlDocument[];
};

function firecrawlApiKey() {
  const value = process.env.FIRECRAWL_API_KEY?.trim();
  if (!value) throw new Error("FIRECRAWL_NOT_CONFIGURED");
  return value;
}

export function firecrawlWebhookUrl() {
  return new URL("/api/webhooks/firecrawl", getMetadataBase()).toString();
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header >= 0) return Math.min(header * 1_000, 10_000);
  return Math.min(1_000 * 2 ** attempt, 10_000);
}

function requestOperation(pathOrUrl: string) {
  const pathname = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl).pathname : pathOrUrl;
  if (pathname === "/v2/search" || pathname === "/search") return "search";
  if (/\/batch\/scrape\/[^/]+$/.test(pathname)) return "batch.status";
  if (pathname.endsWith("/batch/scrape") || pathname === "/batch/scrape") return "batch.start";
  if (/\/crawl\/[^/]+$/.test(pathname)) return "crawl.status";
  if (pathname.endsWith("/crawl") || pathname === "/crawl") return "crawl.start";
  return "api.request";
}

async function firecrawlRequest<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${FIRECRAWL_BASE_URL}${pathOrUrl}`;
  const operation = requestOperation(pathOrUrl);
  const apiKey = firecrawlApiKey();
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = Date.now();
    researchLog("info", "firecrawl.api.request", { operation, method: init.method ?? "GET", attempt: attempt + 1 });
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(60_000),
      });
    } catch (cause) {
      const failureCode = researchErrorCode(cause);
      if (attempt === 2) {
        researchLog("error", "firecrawl.api.failed", { operation, attempt: attempt + 1, failureCode, durationMs: Date.now() - startedAt });
        throw new Error(`FIRECRAWL_${failureCode}`);
      }
      const delayMs = Math.min(1_000 * 2 ** attempt, 10_000);
      researchLog("warn", "firecrawl.api.retry", { operation, attempt: attempt + 1, failureCode, delayMs });
      await wait(delayMs);
      continue;
    }
    if (response.ok) {
      researchLog("info", "firecrawl.api.succeeded", { operation, attempt: attempt + 1, status: response.status, durationMs: Date.now() - startedAt });
      return response.json() as Promise<T>;
    }
    lastResponse = response;
    if (!retryableStatuses.has(response.status) || attempt === 2) {
      researchLog("error", "firecrawl.api.failed", { operation, attempt: attempt + 1, status: response.status, durationMs: Date.now() - startedAt });
      break;
    }
    const delayMs = retryDelay(response, attempt);
    researchLog("warn", "firecrawl.api.retry", { operation, attempt: attempt + 1, status: response.status, delayMs });
    await wait(delayMs);
  }
  throw new Error(`FIRECRAWL_HTTP_${lastResponse?.status ?? "FAILED"}`);
}

function privateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function publicHttpsUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.includes(":") || privateIpv4(hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedHost(value: string | null | undefined) {
  const url = publicHttpsUrl(value);
  return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null;
}

function isExcludedRelatedUrl(value: string) {
  const host = normalizedHost(value);
  return !host || excludedRelatedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export async function searchComparableSources(company: YcCompany): Promise<ReportResearchTarget[]> {
  researchLog("info", "firecrawl.search.started", { companyId: company.id, companyName: company.name });
  const response = await firecrawlRequest<{ success: boolean; data?: { web?: FirecrawlSearchResult[] } }>("/search", {
    method: "POST",
    body: JSON.stringify({
      query: `"${company.name}" product customers business model traction founders interview`,
      limit: 6,
      sources: ["web"],
      ignoreInvalidURLs: true,
      timeout: 30_000,
    }),
  });
  const companyHost = normalizedHost(company.website);
  const seen = new Set<string>();
  const rawResults = response.data?.web ?? [];
  const selected = rawResults.flatMap((result) => {
    const url = publicHttpsUrl(result.url);
    if (!url || isExcludedRelatedUrl(url)) return [];
    const canonical = url.replace(/\/$/, "");
    const host = normalizedHost(url);
    if (seen.has(canonical) || host === companyHost || host === "ycombinator.com") return [];
    seen.add(canonical);
    const text = `${result.title ?? ""} ${result.description ?? ""}`;
    return [{
      companyId: company.id,
      url,
      sourceType: /founder|interview|ceo|cto|co-founder/i.test(text) ? "founder-source" as const : "related-coverage" as const,
    }];
  }).slice(0, appConfig.reportResearch.relatedSourceLimit);
  researchLog("info", "firecrawl.search.completed", { companyId: company.id, candidates: rawResults.length, selected: selected.length });
  return selected;
}

function webhook(reportId: string) {
  if (!process.env.FIRECRAWL_WEBHOOK_SECRET?.trim()) return null;
  const url = publicHttpsUrl(firecrawlWebhookUrl());
  if (!url) {
    researchLog("warn", "firecrawl.webhook.disabled", { reportId, reason: "CALLBACK_NOT_PUBLIC_HTTPS" });
    return null;
  }
  return {
    url,
    events: ["completed", "failed"],
    metadata: { reportId },
  };
}

export async function startWebsiteCrawl(reportId: string, company: YcCompany) {
  const url = publicHttpsUrl(company.website);
  if (!url) {
    researchLog("warn", "firecrawl.crawl.skipped", { reportId, companyId: company.id, reason: "INVALID_PUBLIC_HTTPS_URL" });
    return null;
  }
  researchLog("info", "firecrawl.crawl.started", { reportId, companyId: company.id, pageLimit: appConfig.reportResearch.websitePageLimit, maxDepth: 1 });
  const webhookConfig = webhook(reportId);
  const result = await firecrawlRequest<FirecrawlJobStart>("/crawl", {
    method: "POST",
    body: JSON.stringify({
      url,
      maxDiscoveryDepth: 1,
      sitemap: "include",
      ignoreQueryParameters: true,
      limit: appConfig.reportResearch.websitePageLimit,
      crawlEntireDomain: true,
      allowExternalLinks: false,
      allowSubdomains: false,
      ignoreRobotsTxt: false,
      maxConcurrency: 2,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        maxAge: appConfig.reportResearch.cacheMaxAgeMs,
        removeBase64Images: true,
        blockAds: true,
      },
      ...(webhookConfig ? { webhook: webhookConfig } : {}),
    }),
  });
  researchLog("info", "firecrawl.crawl.queued", { reportId, companyId: company.id, firecrawlJobId: result.id });
  return {
    firecrawlJobId: result.id,
    target: { companyId: company.id, url, sourceType: "company-website" as const },
  };
}

export async function startRelatedBatch(reportId: string, targets: ReportResearchTarget[]) {
  const unique = [...new Map(targets.map((target) => [target.url.replace(/\/$/, ""), target])).values()];
  if (!unique.length) {
    researchLog("warn", "firecrawl.batch.skipped", { reportId, reason: "NO_VALID_TARGETS" });
    return null;
  }
  researchLog("info", "firecrawl.batch.started", { reportId, targetCount: unique.length });
  const webhookConfig = webhook(reportId);
  const result = await firecrawlRequest<FirecrawlJobStart>("/batch/scrape", {
    method: "POST",
    body: JSON.stringify({
      urls: unique.map((target) => target.url),
      ignoreInvalidURLs: true,
      maxConcurrency: 3,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: appConfig.reportResearch.cacheMaxAgeMs,
      removeBase64Images: true,
      blockAds: true,
      ...(webhookConfig ? { webhook: webhookConfig } : {}),
    }),
  });
  researchLog("info", "firecrawl.batch.queued", { reportId, targetCount: unique.length, firecrawlJobId: result.id });
  return { firecrawlJobId: result.id, targets: unique };
}

function firecrawlDocument(value: unknown): FirecrawlDocument | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { markdown?: unknown; metadata?: unknown };
  if (typeof row.markdown !== "string" || !row.markdown.trim() || !row.metadata || typeof row.metadata !== "object") return null;
  return { markdown: row.markdown, metadata: row.metadata as FirecrawlDocument["metadata"] };
}

export async function getFirecrawlJob(kind: "crawl" | "batch-scrape", jobId: string): Promise<FirecrawlJobSnapshot> {
  researchLog("info", "firecrawl.job.poll.started", { kind, firecrawlJobId: jobId });
  const endpoint = kind === "crawl" ? `/crawl/${encodeURIComponent(jobId)}` : `/batch/scrape/${encodeURIComponent(jobId)}`;
  let next: string | null = endpoint;
  let first: { status?: string; completed?: number; total?: number; creditsUsed?: number } | null = null;
  const documents: FirecrawlDocument[] = [];
  while (next) {
    const response: {
      status?: string;
      completed?: number;
      total?: number;
      creditsUsed?: number;
      next?: string | null;
      data?: unknown[];
    } = await firecrawlRequest(next);
    first ??= response;
    documents.push(...(response.data ?? []).flatMap((item) => {
      const parsed = firecrawlDocument(item);
      return parsed ? [parsed] : [];
    }));
    next = response.next ?? null;
  }
  const snapshot: FirecrawlJobSnapshot = {
    status: first?.status === "completed" ? "completed" : first?.status === "failed" ? "failed" : "scraping",
    completed: Number(first?.completed ?? documents.length),
    total: Number(first?.total ?? documents.length),
    creditsUsed: Number(first?.creditsUsed ?? 0),
    documents,
  };
  researchLog("info", "firecrawl.job.poll.completed", {
    kind,
    firecrawlJobId: jobId,
    status: snapshot.status,
    completed: snapshot.completed,
    total: snapshot.total,
    creditsUsed: snapshot.creditsUsed,
    documentCount: snapshot.documents.length,
  });
  return snapshot;
}

export function verifyFirecrawlSignature(rawBody: string, signature: string | null, secret = process.env.FIRECRAWL_WEBHOOK_SECRET) {
  const configured = secret?.trim();
  if (!configured || !signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", configured).update(rawBody).digest("hex");
  const received = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
