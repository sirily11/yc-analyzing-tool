import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { generateText, Output } from "ai";
import { appConfig } from "../config";
import { founderProfileSchema, type FounderProfile } from "../lib/types/analysis";
import type { YcCompany } from "../lib/types/company";
import { parseYcCompanyPage } from "../lib/yc/company-detail";

const companiesPath = path.join(process.cwd(), "public/data/yc-companies.json");
const rawPath = path.join(process.cwd(), "ml/data/raw/founder-biographies.jsonl");
const processedPath = path.join(process.cwd(), "ml/data/processed/founder-profiles.jsonl");

type RawFounderRow = {
  id: number;
  founderCount: number;
  biographies: string[];
  status: "ready" | "missing" | "error";
  fetchedAt: string;
  error?: string;
};

type ProcessedFounderRow = FounderProfile & { id: number };

const signalSchema = founderProfileSchema.pick({
  capabilityDomains: true,
  domainExperience: true,
  technicalCapability: true,
  priorBuildingExperience: true,
  teamComplementarity: true,
});

export function founderCountBand(count: number): FounderProfile["founderCountBand"] {
  if (count === 1) return "solo";
  if (count === 2) return "two";
  if (count >= 3) return "three-plus";
  return "unknown";
}

export function founderEvidenceCoverage(profile: Pick<FounderProfile, "capabilityDomains" | "domainExperience" | "technicalCapability" | "priorBuildingExperience" | "teamComplementarity">) {
  const signals = [
    profile.capabilityDomains.length > 0,
    profile.domainExperience !== "not-evidenced",
    profile.technicalCapability !== "not-evidenced",
    profile.priorBuildingExperience !== "not-evidenced",
    profile.teamComplementarity === "demonstrated",
  ].filter(Boolean).length;
  return signals / 5;
}

export function missingFounderProfile(id: number, count = 0): ProcessedFounderRow {
  return {
    id,
    founderCountBand: founderCountBand(count),
    capabilityDomains: [],
    domainExperience: "not-evidenced",
    technicalCapability: "not-evidenced",
    priorBuildingExperience: "not-evidenced",
    teamComplementarity: count === 1 ? "not-applicable" : "unknown",
    evidencePages: [],
    missingFields: ["founder background"],
    coverage: 0,
  };
}

function parseJsonl<T extends { id: number }>(text: string) {
  const rows = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
  return new Map(rows.map((row) => [row.id, row]));
}

async function retry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function fetchFounderRow(company: YcCompany): Promise<RawFounderRow> {
  try {
    const detail = await retry(async () => {
      const response = await fetch(`https://www.ycombinator.com/companies/${encodeURIComponent(company.slug)}`, {
        headers: { Accept: "text/html", "User-Agent": "Application-Signal founder-fit research" },
      });
      if (!response.ok) throw new Error(`YC returned ${response.status}`);
      return parseYcCompanyPage(await response.text());
    });
    const biographies = detail.founders.map((founder) => founder.bio.trim()).filter(Boolean);
    return {
      id: company.id,
      founderCount: detail.founders.length,
      biographies,
      status: biographies.length ? "ready" : "missing",
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id: company.id,
      founderCount: 0,
      biographies: [],
      status: "error",
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Founder page fetch failed",
    };
  }
}

async function categorizeFounderRow(company: YcCompany, raw: RawFounderRow): Promise<ProcessedFounderRow> {
  if (raw.status !== "ready") return missingFounderProfile(company.id, raw.founderCount);
  const { output } = await retry(() => generateText({
    model: appConfig.analysisModel,
    temperature: 0,
    output: Output.object({ schema: signalSchema }),
    system: `Extract only job-relevant, pre-company founder evidence from public YC-hosted biographies.

Use the controlled schema exactly. Capability domains describe demonstrated work, not employer or school prestige. Domain experience is relative to the supplied startup. "Demonstrated" requires a concrete prior accomplishment; a role or self-description alone is "stated". Use "not-evidenced" whenever timing or evidence is unclear. Team complementarity requires evidence of distinct useful capabilities across founders.

Ignore and never reproduce names, age, gender, ethnicity, nationality, named schools, named employers, funding, YC status, current-company growth, and any achievement that may have occurred after the company joined YC.`,
    prompt: JSON.stringify({
      company: { oneLiner: company.oneLiner, industry: company.industry, subindustry: company.subindustry, targetMarket: company.targetMarket },
      founderCount: raw.founderCount,
      biographies: raw.biographies,
    }),
    providerOptions: { gateway: { tags: ["application-signal", "offline-founder-enrichment"] } },
  }));
  const countBand = founderCountBand(raw.founderCount);
  const normalized = {
    ...output,
    teamComplementarity: countBand === "solo" ? "not-applicable" as const : output.teamComplementarity,
  };
  const coverage = founderEvidenceCoverage(normalized);
  return {
    id: company.id,
    founderCountBand: countBand,
    ...normalized,
    evidencePages: [],
    missingFields: coverage > 0 ? [] : ["founder background"],
    coverage,
  };
}

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is required for founder enrichment.");
  await Promise.all([mkdir(path.dirname(rawPath), { recursive: true }), mkdir(path.dirname(processedPath), { recursive: true })]);
  const companies = JSON.parse(await readFile(companiesPath, "utf8")) as YcCompany[];
  const rawExisting = parseJsonl<RawFounderRow>(await readFile(rawPath, "utf8").catch(() => ""));
  const fetchConcurrency = Math.max(1, Math.min(6, Number(process.env.FOUNDER_FETCH_CONCURRENCY ?? 3)));
  const fetchPending = companies.filter((company) => !rawExisting.has(company.id) || rawExisting.get(company.id)?.status === "error");
  console.log(`Fetching ${fetchPending.length.toLocaleString()} YC founder pages with concurrency ${fetchConcurrency}.`);
  let fetchErrors = 0;
  for (let offset = 0; offset < fetchPending.length; offset += fetchConcurrency) {
    const rows = await Promise.all(fetchPending.slice(offset, offset + fetchConcurrency).map(fetchFounderRow));
    await appendFile(rawPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    fetchErrors += rows.filter((row) => row.status === "error").length;
    console.log(`${Math.min(offset + rows.length, fetchPending.length).toLocaleString()}/${fetchPending.length.toLocaleString()} founder pages fetched`);
  }
  if (fetchErrors) throw new Error(`${fetchErrors} founder pages still failed after retries. Run model:founders again to resume.`);

  const rawRows = parseJsonl<RawFounderRow>(await readFile(rawPath, "utf8"));
  const processedExisting = parseJsonl<ProcessedFounderRow>(await readFile(processedPath, "utf8").catch(() => ""));
  const categorizeConcurrency = Math.max(1, Math.min(12, Number(process.env.FOUNDER_CATEGORIZATION_CONCURRENCY ?? 8)));
  const categorizePending = companies.filter((company) => !processedExisting.has(company.id));
  console.log(`Categorizing ${categorizePending.length.toLocaleString()} founder profiles with concurrency ${categorizeConcurrency}.`);
  for (let offset = 0; offset < categorizePending.length; offset += categorizeConcurrency) {
    const batch = categorizePending.slice(offset, offset + categorizeConcurrency);
    const rows = await Promise.all(batch.map((company) => categorizeFounderRow(company, rawRows.get(company.id) ?? {
      id: company.id, founderCount: 0, biographies: [], status: "missing", fetchedAt: new Date().toISOString(),
    })));
    await appendFile(processedPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    console.log(`${Math.min(offset + rows.length, categorizePending.length).toLocaleString()}/${categorizePending.length.toLocaleString()} founder profiles categorized`);
  }
}

if (import.meta.main) await main();
