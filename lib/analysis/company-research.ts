import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { appConfig } from "@/config";
import { batchScrapeFirecrawl, mapFirecrawl, searchFirecrawl, selectOfficialPages } from "@/lib/firecrawl/client";
import { companyResearchDraftSchema, type CompanyResearchDraft, type CompanyResearchSource } from "@/lib/types/company-research";
import type { YcCompany, YcCompanyDetail } from "@/lib/types/company";
import { fetchYcCompanyDetail } from "@/lib/yc/company-data";

const synthesisSchema = companyResearchDraftSchema.pick({
  title: true,
  executiveSummary: true,
  companies: true,
  comparison: true,
  warnings: true,
  methodology: true,
});

type Evidence = { sourceId: string; companyId: number; text: string };

async function concurrentMap<T, R>(values: T[], concurrency: number, map: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await map(values[index]);
    }
  }));
  return results;
}

function detailText(detail: YcCompanyDetail | null) {
  if (!detail) return "Live YC details were unavailable.";
  return JSON.stringify({
    description: detail.longDescription,
    yearFounded: detail.yearFounded,
    teamSize: detail.teamSize,
    status: detail.status,
    tags: detail.tags,
    founders: detail.founders.map((founder) => ({ title: founder.title, bio: founder.bio })),
  });
}

function officialHost(company: YcCompany) {
  try {
    return company.website ? new URL(company.website).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function validateCitations(draft: CompanyResearchDraft) {
  const validSources = new Set(draft.sources.filter((source) => source.status === "ok").map((source) => source.id));
  const cited = [
    ...draft.companies.flatMap((company) => [company.overview, company.product, company.customers, company.businessModel, ...company.signals]),
    ...draft.comparison.sharedPatterns,
    ...draft.comparison.differentiators,
    ...draft.comparison.opportunities,
    ...draft.comparison.risks,
  ];
  for (const insight of cited) {
    if (!insight.sourceIds.length || insight.sourceIds.some((sourceId) => !validSources.has(sourceId))) {
      throw new Error("COMPANY_RESEARCH_INVALID_CITATION");
    }
  }
}

export async function buildCompanyResearchDraft(input: { companies: YcCompany[]; request: string; signal?: AbortSignal }): Promise<CompanyResearchDraft> {
  const deadlineSignal = AbortSignal.timeout(45_000);
  const researchSignal = input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal;
  const retrievedAt = new Date().toISOString();
  const warnings: string[] = [];
  const sources: CompanyResearchSource[] = [];
  const evidence: Evidence[] = [];

  const details = await concurrentMap(input.companies, 5, async (company) => {
    try {
      return await fetchYcCompanyDetail(company.slug, researchSignal);
    } catch {
      warnings.push(`${company.name}: live YC profile details were unavailable; the versioned directory snapshot was used.`);
      return null;
    }
  });

  input.companies.forEach((company, index) => {
    const sourceId = `c${company.id}-yc`;
    sources.push({ id: sourceId, companyId: company.id, kind: "yc-profile", title: `${company.name} — Y Combinator`, url: `https://www.ycombinator.com/companies/${company.slug}`, retrievedAt, status: "ok" });
    evidence.push({
      sourceId,
      companyId: company.id,
      text: JSON.stringify({ company, detail: detailText(details[index]) }).slice(0, 8_000),
    });
  });

  const webResults = await concurrentMap(input.companies, 4, async (company) => {
    const query = `"${company.name}" ${officialHost(company) ?? "YC startup"} ${input.request.slice(0, 120)}`;
    const [search, mapped] = await Promise.allSettled([
      searchFirecrawl(query, researchSignal),
      company.website ? mapFirecrawl(company.website, researchSignal) : Promise.resolve([]),
    ]);
    if (search.status === "rejected") warnings.push(`${company.name}: Firecrawl search was unavailable.`);
    if (mapped.status === "rejected") warnings.push(`${company.name}: official-site discovery was unavailable.`);
    return {
      company,
      search: search.status === "fulfilled" ? search.value : [],
      pages: company.website ? selectOfficialPages(company.website, mapped.status === "fulfilled" ? mapped.value : []) : [],
    };
  });

  const requestedPages = [...new Set(webResults.flatMap((result) => result.pages))];
  let scrapedPages: Awaited<ReturnType<typeof batchScrapeFirecrawl>> = [];
  try {
    scrapedPages = await batchScrapeFirecrawl(requestedPages, researchSignal);
  } catch {
    warnings.push("Firecrawl could not complete the bounded official-site scrape.");
  }
  const scrapedByUrl = new Map(scrapedPages.map((page) => [page.url.replace(/\/$/, ""), page]));
  let firecrawlSuccesses = 0;

  for (const result of webResults) {
    const host = officialHost(result.company);
    result.pages.forEach((url, index) => {
      const page = scrapedByUrl.get(url.replace(/\/$/, ""));
      const sourceId = `c${result.company.id}-site${index + 1}`;
      sources.push({
        id: sourceId,
        companyId: result.company.id,
        kind: "official-site",
        title: page?.title || `${result.company.name} official site`,
        url,
        retrievedAt,
        status: page ? "ok" : "failed",
        ...(!page ? { note: "The page could not be scraped within the research budget." } : {}),
      });
      if (page) {
        firecrawlSuccesses += 1;
        evidence.push({ sourceId, companyId: result.company.id, text: page.markdown });
      }
    });
    result.search.filter((item) => {
      try {
        const itemHost = new URL(item.url).hostname.replace(/^www\./, "");
        return itemHost !== host && itemHost !== "ycombinator.com";
      } catch {
        return false;
      }
    }).slice(0, 3).forEach((item, index) => {
      const sourceId = `c${result.company.id}-web${index + 1}`;
      sources.push({ id: sourceId, companyId: result.company.id, kind: "web-search", title: item.title, url: item.url, retrievedAt, status: "ok" });
      evidence.push({ sourceId, companyId: result.company.id, text: item.description });
      firecrawlSuccesses += 1;
    });
  }

  if (firecrawlSuccesses === 0) throw new Error("FIRECRAWL_RESEARCH_UNAVAILABLE");

  const { output } = await generateText({
    model: appConfig.analysisModel,
    temperature: 0,
    output: Output.object({ schema: synthesisSchema }),
    system: `Create a conservative, citation-backed research report about the supplied public YC companies. Answer the user's requested focus. Use only the evidence objects. Every overview, product, customer, business-model, signal, comparison, opportunity, and risk statement must cite one or more exact sourceId values that support it. Never cite a failed source. Mark unknown facts instead of guessing. Do not generate a YC Fit Score, acceptance probability, admissions advice, or investment recommendation. Keep semanticText factual and compact for semantic mapping; do not include source IDs in it.`,
    prompt: JSON.stringify({ request: input.request, companies: input.companies.map(({ id, name, slug, batch, industry, location, website }) => ({ id, name, slug, batch, industry, location, website })), evidence }),
  });

  const byId = new Map(input.companies.map((company) => [company.id, company]));
  const profiles = output.companies.map((profile) => {
    const company = byId.get(profile.companyId);
    if (!company) throw new Error("COMPANY_RESEARCH_UNKNOWN_COMPANY");
    return { ...profile, name: company.name, slug: company.slug, batch: company.batch, industry: company.industry, location: company.location, website: company.website };
  });
  if (profiles.length !== input.companies.length || new Set(profiles.map((profile) => profile.companyId)).size !== input.companies.length) {
    throw new Error("COMPANY_RESEARCH_COMPANY_MISMATCH");
  }

  const draft = companyResearchDraftSchema.parse({
    ...output,
    kind: "company-research",
    request: input.request,
    companies: profiles,
    sources,
    warnings: [...new Set([...warnings, ...output.warnings])],
    generatedAt: retrievedAt,
  });
  validateCitations(draft);
  return draft;
}

export { validateCitations };
