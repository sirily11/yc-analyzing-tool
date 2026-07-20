import "server-only";
import { z } from "zod";

const API_BASE = "https://api.firecrawl.dev/v2";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1_000;

const searchResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    web: z.array(z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      url: z.string().url(),
    })).default([]),
  }),
});

const mapResponseSchema = z.object({
  success: z.boolean(),
  links: z.array(z.object({
    url: z.string().url(),
    title: z.string().optional(),
    description: z.string().optional(),
  })).default([]),
});

const batchStartSchema = z.object({
  success: z.boolean(),
  id: z.string().min(1),
  invalidURLs: z.array(z.string()).nullable().optional(),
});
const batchStatusSchema = z.object({
  status: z.enum(["scraping", "completed", "failed"]),
  data: z.array(z.object({
    markdown: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).default([]),
});
const batchErrorsSchema = z.object({
  errors: z.array(z.object({
    url: z.string(),
    error: z.string(),
  })).default([]),
  robotsBlocked: z.array(z.string()).default([]),
});

export type FirecrawlSearchResult = { title: string; description: string; url: string };
export type FirecrawlPage = { url: string; title: string; markdown: string };
export type FirecrawlScrapeFailure = { url: string; message: string };

export class FirecrawlScrapeError extends Error {
  readonly failures: FirecrawlScrapeFailure[];

  constructor(failures: FirecrawlScrapeFailure[]) {
    super("FIRECRAWL_SCRAPE_FAILED");
    this.name = "FirecrawlScrapeError";
    this.failures = failures;
  }
}

function apiKey() {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_NOT_CONFIGURED");
  return key;
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Firecrawl request stopped.", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

async function firecrawlRequest(pathname: string, init: RequestInit, signal?: AbortSignal, retry = true): Promise<unknown> {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal,
  });
  if (response.status === 429 && retry) {
    const retryAfter = Math.min(3, Math.max(0, Number(response.headers.get("Retry-After") ?? 1)));
    await wait(retryAfter * 1_000, signal);
    return firecrawlRequest(pathname, init, signal, false);
  }
  if (!response.ok) throw new Error(`FIRECRAWL_REQUEST_FAILED:${response.status}`);
  return response.json();
}

export async function searchFirecrawl(query: string, signal?: AbortSignal): Promise<FirecrawlSearchResult[]> {
  const parsed = searchResponseSchema.parse(await firecrawlRequest("/search", {
    method: "POST",
    body: JSON.stringify({ query: query.slice(0, 500), limit: 3, sources: ["web"], ignoreInvalidURLs: true, timeout: 12_000 }),
  }, signal));
  return parsed.data.web.slice(0, 3).map((result) => ({
    title: result.title?.trim() || result.url,
    description: result.description?.trim().slice(0, 1_500) || "No search description was returned.",
    url: result.url,
  }));
}

export async function mapFirecrawl(url: string, signal?: AbortSignal) {
  const parsed = mapResponseSchema.parse(await firecrawlRequest("/map", {
    method: "POST",
    body: JSON.stringify({ url, sitemap: "include", includeSubdomains: false, ignoreQueryParameters: true, limit: 25, timeout: 12_000 }),
  }, signal));
  return parsed.links;
}

function pageRank(url: URL) {
  const path = url.pathname.toLowerCase().replace(/\/$/, "");
  if (!path) return 1_000;
  if (/\/(product|platform|solutions?)(\/|$)/.test(path)) return 800;
  if (/\/(about|company)(\/|$)/.test(path)) return 700;
  if (/\/(pricing|customers?)(\/|$)/.test(path)) return 600;
  if (/\/(blog|news|careers?|jobs?|legal|privacy|terms)(\/|$)/.test(path)) return -100;
  return 100 - path.split("/").length;
}

export function selectOfficialPages(website: string, links: Array<{ url: string }>, limit = 3) {
  const base = new URL(website);
  const candidates = [website, ...links.map((link) => link.url)].flatMap((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return [];
      if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return [];
      url.hash = "";
      return [url];
    } catch {
      return [];
    }
  });
  const unique = [...new Map(candidates.map((url) => [url.toString(), url])).values()];
  return unique.sort((left, right) => pageRank(right) - pageRank(left) || left.toString().localeCompare(right.toString())).slice(0, limit).map(String);
}

function uniqueScrapeFailures(failures: FirecrawlScrapeFailure[]) {
  return [...new Map(failures.map((failure) => [`${failure.url}\n${failure.message}`, failure])).values()];
}

async function getBatchScrapeFailures(id: string, invalidURLs: string[], signal?: AbortSignal) {
  const parsed = batchErrorsSchema.parse(await firecrawlRequest(`/batch/scrape/${encodeURIComponent(id)}/errors`, { method: "GET" }, signal));
  return uniqueScrapeFailures([
    ...invalidURLs.map((url) => ({ url, message: "Firecrawl rejected this URL as invalid." })),
    ...parsed.errors.map((failure) => ({ url: failure.url, message: failure.error.slice(0, 500) })),
    ...parsed.robotsBlocked.map((url) => ({ url, message: "Scraping was blocked by robots.txt." })),
  ]);
}

export async function batchScrapeFirecrawl(urls: string[], signal?: AbortSignal): Promise<FirecrawlPage[]> {
  if (!urls.length) return [];
  const started = batchStartSchema.parse(await firecrawlRequest("/batch/scrape", {
    method: "POST",
    body: JSON.stringify({
      urls,
      maxConcurrency: 4,
      ignoreInvalidURLs: true,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: TWO_DAYS_MS,
      timeout: 15_000,
      removeBase64Images: true,
      blockAds: true,
    }),
  }, signal));
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const status = batchStatusSchema.parse(await firecrawlRequest(`/batch/scrape/${encodeURIComponent(started.id)}`, { method: "GET" }, signal));
    if (status.status === "failed" || status.status === "completed") {
      const pages = status.data.flatMap((page) => {
        const sourceUrl = typeof page.metadata?.sourceURL === "string" ? page.metadata.sourceURL : typeof page.metadata?.url === "string" ? page.metadata.url : "";
        if (!sourceUrl || !page.markdown?.trim()) return [];
        const title = typeof page.metadata?.title === "string" ? page.metadata.title : sourceUrl;
        return [{ url: sourceUrl, title, markdown: page.markdown.slice(0, 8_000) }];
      });
      const failures = await getBatchScrapeFailures(started.id, started.invalidURLs ?? [], signal);
      const completedUrls = new Set(pages.map((page) => page.url.replace(/\/$/, "")));
      const failedUrls = new Set(failures.map((failure) => failure.url.replace(/\/$/, "")));
      for (const url of urls) {
        const normalized = url.replace(/\/$/, "");
        if (!completedUrls.has(normalized) && !failedUrls.has(normalized)) {
          failures.push({ url, message: "Firecrawl returned no usable content for this URL." });
        }
      }
      if (failures.length > 0) throw new FirecrawlScrapeError(uniqueScrapeFailures(failures));
      if (status.status === "failed") throw new Error("FIRECRAWL_BATCH_FAILED");
      return pages;
    }
    await wait(1_000, signal);
  }
  throw new Error("FIRECRAWL_BATCH_TIMEOUT");
}
