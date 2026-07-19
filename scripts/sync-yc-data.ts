import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatasetManifest, YcCompany } from "../lib/types/company";

const SOURCE = "https://yc-oss.github.io/api/companies/all.json";
const FIRST_YEAR = 2022;
const LAST_YEAR = 2026;

type SourceCompany = {
  id: number;
  name: string;
  slug: string;
  website?: string;
  batch?: string;
  industry?: string;
  subindustry?: string;
  one_liner?: string;
  long_description?: string;
  all_locations?: string;
  regions?: string[];
  tags?: string[];
  isHiring?: boolean;
  small_logo_thumb_url?: string;
};

const marketRules: Array<[RegExp, string]> = [
  [/developer|infrastructure|security|engineering|api|data|analytics/i, "Developers & IT"],
  [/health|therapeutic|medical|clinical|biotech|drug/i, "Health & life sciences"],
  [/fintech|bank|payment|insurance|credit|finance/i, "Financial services"],
  [/consumer|gaming|social|food|travel|home|apparel/i, "Consumers"],
  [/government|defense|public sector/i, "Public sector & defense"],
  [/industrial|manufactur|robot|construction|supply chain|automotive/i, "Industrial & physical economy"],
  [/education/i, "Education"],
];

function targetMarket(company: SourceCompany) {
  const haystack = [
    company.industry,
    company.subindustry,
    company.one_liner,
    ...(company.tags ?? []),
  ].join(" ");
  return marketRules.find(([rule]) => rule.test(haystack))?.[1] ?? "Business teams";
}

function operatingArea(company: SourceCompany) {
  const value = `${company.all_locations ?? ""} ${(company.regions ?? []).join(" ")}`;
  if (/san francisco|bay area/i.test(value)) return "SF Bay Area";
  if (/india/i.test(value)) return "India";
  if (/canada/i.test(value)) return "Canada";
  if (/europe|united kingdom|germany|france|spain|netherlands/i.test(value)) return "Europe";
  if (/asia|singapore|japan|korea|australia/i.test(value)) return "Asia-Pacific";
  if (/africa|middle east/i.test(value)) return "Africa & Middle East";
  if (/latin|brazil|mexico|argentina|colombia/i.test(value)) return "Latin America";
  if (/united states|usa|new york|boston|austin|seattle|chicago/i.test(value)) return "United States — other";
  return value.trim() ? "Other international" : "Remote / not listed";
}

function hash(input: string) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function jitter(seed: number, offset: number) {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

function clusterPoint(industry: string, market: string, id: number) {
  const sectorSeed = hash(industry);
  const marketSeed = hash(market);
  const column = sectorSeed % 4;
  const row = marketSeed % 3;
  return {
    x: Number(Math.min(0.96, Math.max(0.04, 0.14 + column * 0.235 + jitter(id, 1) * 0.2)).toFixed(5)),
    y: Number(Math.min(0.94, Math.max(0.06, 0.2 + row * 0.3 + jitter(id, 2) * 0.24)).toFixed(5)),
  };
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`YC data download failed: ${response.status}`);
const source = (await response.json()) as SourceCompany[];

const companies = source.flatMap<YcCompany>((company) => {
  const yearMatch = company.batch?.match(/(20\d{2})/);
  const year = Number(yearMatch?.[1] ?? 0);
  if (year < FIRST_YEAR || year > LAST_YEAR) return [];
  const industry = company.industry?.trim() || "Unspecified";
  const market = targetMarket(company);
  const point = clusterPoint(industry, market, company.id);
  const text = `${company.one_liner ?? ""} ${company.long_description ?? ""} ${(company.tags ?? []).join(" ")}`;
  return [{
    id: company.id,
    name: company.name,
    slug: company.slug,
    website: company.website || null,
    batch: company.batch || `Unspecified ${year}`,
    year,
    industry,
    subindustry: company.subindustry?.trim() || industry,
    oneLiner: company.one_liner?.trim() || "No public description available.",
    location: company.all_locations?.trim() || "Remote / not listed",
    operatingArea: operatingArea(company),
    targetMarket: market,
    aiLinked: /\b(ai|artificial intelligence|machine learning|llm|agent)\b/i.test(text),
    hiring: Boolean(company.isHiring),
    logo: company.small_logo_thumb_url || null,
    ...point,
  }];
});

companies.sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));
const manifest: DatasetManifest = {
  version: "yc-2022-2026-ytd-v1",
  source: SOURCE,
  generatedAt: new Date().toISOString(),
  firstYear: FIRST_YEAR,
  lastYear: LAST_YEAR,
  companyCount: companies.length,
  batches: [...new Set(companies.map((company) => company.batch))].sort(),
  industries: [...new Set(companies.map((company) => company.industry))].sort(),
};

const target = path.join(process.cwd(), "public", "data");
await mkdir(target, { recursive: true });
await Promise.all([
  writeFile(path.join(target, "yc-companies.json"), JSON.stringify(companies)),
  writeFile(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2)),
]);

console.log(`Wrote ${companies.length.toLocaleString()} companies to public/data.`);
