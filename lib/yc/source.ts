import type { DatasetManifest, YcCompany } from "@/lib/types/company";

export const YC_SOURCE_URL = "https://yc-oss.github.io/api/companies/all.json";
export const YC_FIRST_YEAR = 2020;

export type YcSourceCompany = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  former_names?: unknown;
  website?: unknown;
  batch?: unknown;
  industry?: unknown;
  subindustry?: unknown;
  one_liner?: unknown;
  long_description?: unknown;
  all_locations?: unknown;
  regions?: unknown;
  tags?: unknown;
  isHiring?: unknown;
  small_logo_thumb_url?: unknown;
};

export type YcCompanySourceRecord = YcCompany & {
  formerNames: string[];
  longDescription: string;
  regions: string[];
  tags: string[];
  embeddingText: string;
};

export type YcCoordinate = Pick<YcCompany, "x" | "y">;
export type YcCoordinateMap = ReadonlyMap<number, YcCoordinate>;

const marketRules: Array<[RegExp, string]> = [
  [/developer|infrastructure|security|engineering|api|data|analytics/i, "Developers & IT"],
  [/health|therapeutic|medical|clinical|biotech|drug/i, "Health & life sciences"],
  [/fintech|bank|payment|insurance|credit|finance/i, "Financial services"],
  [/consumer|gaming|social|food|travel|home|apparel/i, "Consumers"],
  [/government|defense|public sector/i, "Public sector & defense"],
  [/industrial|manufactur|robot|construction|supply chain|automotive/i, "Industrial & physical economy"],
  [/education/i, "Education"],
];

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function textList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

function stableCompanyId(value: unknown) {
  const id = typeof value === "number" ? value : Number(text(value));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function currentUtcYear(now: Date = new Date()) {
  return now.getUTCFullYear();
}

export function batchYear(value: unknown) {
  const match = text(value).match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

function targetMarket(company: YcSourceCompany) {
  const haystack = [
    text(company.industry),
    text(company.subindustry),
    text(company.one_liner),
    ...textList(company.tags),
  ].join(" ");
  return marketRules.find(([rule]) => rule.test(haystack))?.[1] ?? "Business teams";
}

function operatingArea(location: string, regions: string[]) {
  const value = `${location} ${regions.join(" ")}`;
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

export function deterministicCompanyCoordinates(industry: string, market: string, id: number): YcCoordinate {
  const column = hash(industry) % 4;
  const row = hash(market) % 3;
  return {
    x: Number(Math.min(0.96, Math.max(0.04, 0.14 + column * 0.235 + jitter(id, 1) * 0.2)).toFixed(5)),
    y: Number(Math.min(0.94, Math.max(0.06, 0.2 + row * 0.3 + jitter(id, 2) * 0.24)).toFixed(5)),
  };
}

function normalizedCoordinate(value: YcCoordinate | undefined) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return {
    x: Number(Math.min(1, Math.max(0, value.x)).toFixed(5)),
    y: Number(Math.min(1, Math.max(0, value.y)).toFixed(5)),
  };
}

export function coordinateMapFromCompanies(value: unknown): Map<number, YcCoordinate> {
  if (!Array.isArray(value)) throw new Error("Learned YC coordinates must be a JSON array.");
  const coordinates = new Map<number, YcCoordinate>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = stableCompanyId(record.id);
    const coordinate = normalizedCoordinate({ x: Number(record.x), y: Number(record.y) });
    if (id && coordinate) coordinates.set(id, coordinate);
  }
  return coordinates;
}

export function companyEmbeddingText(company: {
  name: string;
  slug: string;
  formerNames: string[];
  website: string | null;
  oneLiner: string;
  longDescription: string;
  industry: string;
  subindustry: string;
  tags: string[];
  location: string;
  operatingArea: string;
  regions: string[];
  targetMarket: string;
  batch: string;
  aiLinked: boolean;
  hiring: boolean;
}) {
  let websiteDomain = "";
  if (company.website) {
    try {
      const candidate = /^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`;
      websiteDomain = new URL(candidate).hostname.replace(/^www\./i, "");
    } catch {
      websiteDomain = company.website;
    }
  }
  return [
    `Company: ${company.name}`,
    `Slug: ${company.slug}`,
    company.formerNames.length ? `Former names: ${company.formerNames.join(", ")}` : "",
    websiteDomain ? `Website domain: ${websiteDomain}` : "",
    `One-line description: ${company.oneLiner}`,
    company.longDescription ? `Long description: ${company.longDescription}` : "",
    `Industry: ${company.industry}`,
    `Subindustry: ${company.subindustry}`,
    company.tags.length ? `Tags: ${company.tags.join(", ")}` : "",
    `Location: ${company.location}`,
    `Operating area: ${company.operatingArea}`,
    company.regions.length ? `Regions: ${company.regions.join(", ")}` : "",
    `Target market: ${company.targetMarket}`,
    `AI-linked: ${company.aiLinked ? "yes" : "no"}`,
    `Hiring: ${company.hiring ? "yes" : "no"}`,
    `YC batch: ${company.batch}`,
  ].filter(Boolean).join("\n");
}

export function normalizeYcCompanies(
  source: readonly YcSourceCompany[],
  options: {
    firstYear?: number;
    lastYear?: number;
    learnedCoordinates?: YcCoordinateMap;
  } = {},
) {
  const firstYear = options.firstYear ?? YC_FIRST_YEAR;
  const lastYear = options.lastYear ?? currentUtcYear();
  const companies = new Map<number, YcCompanySourceRecord>();

  for (const raw of source) {
    const batch = text(raw.batch);
    const year = batchYear(batch);
    if (year === null || year < firstYear || year > lastYear) continue;

    const id = stableCompanyId(raw.id);
    const name = text(raw.name);
    const slug = text(raw.slug);
    if (id === null || !name || !slug) {
      throw new Error(`YC source row in ${batch} is missing a stable numeric id, name, or slug.`);
    }

    const industry = text(raw.industry) || "Unspecified";
    const subindustry = text(raw.subindustry) || industry;
    const oneLiner = text(raw.one_liner) || "No public description available.";
    const longDescription = text(raw.long_description);
    const formerNames = textList(raw.former_names);
    const tags = textList(raw.tags);
    const regions = textList(raw.regions);
    const location = text(raw.all_locations) || "Remote / not listed";
    const market = targetMarket(raw);
    const learned = normalizedCoordinate(options.learnedCoordinates?.get(id));
    const point = learned ?? deterministicCompanyCoordinates(industry, market, id);
    const aiText = [oneLiner, longDescription, industry, subindustry, ...tags].join(" ");

    const company: YcCompanySourceRecord = {
      id,
      name,
      slug,
      formerNames,
      website: text(raw.website) || null,
      batch,
      year,
      industry,
      subindustry,
      oneLiner,
      longDescription,
      tags,
      regions,
      location,
      operatingArea: operatingArea(location, regions),
      targetMarket: market,
      aiLinked: /\b(ai|artificial intelligence|machine learning|llm|agent)\b/i.test(aiText),
      hiring: raw.isHiring === true,
      logo: text(raw.small_logo_thumb_url) || null,
      ...point,
      embeddingText: "",
    };
    company.embeddingText = companyEmbeddingText(company);
    companies.set(id, company);
  }

  return [...companies.values()].sort((left, right) =>
    right.year - left.year || left.name.localeCompare(right.name) || left.id - right.id
  );
}

export function datasetVersion(lastYear: number) {
  return `yc-${YC_FIRST_YEAR}-${lastYear}-ytd-v3`;
}

export function directoryYcCompany(company: YcCompanySourceRecord): YcCompany {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    website: company.website,
    batch: company.batch,
    year: company.year,
    industry: company.industry,
    subindustry: company.subindustry,
    oneLiner: company.oneLiner,
    location: company.location,
    operatingArea: company.operatingArea,
    targetMarket: company.targetMarket,
    aiLinked: company.aiLinked,
    hiring: company.hiring,
    logo: company.logo,
    x: company.x,
    y: company.y,
  };
}

export function createYcDatasetManifest(
  companies: readonly Pick<YcCompany, "batch" | "industry">[],
  options: {
    generatedAt?: Date;
    lastYear?: number;
    source?: string;
  } = {},
): DatasetManifest {
  const lastYear = options.lastYear ?? currentUtcYear(options.generatedAt);
  return {
    version: datasetVersion(lastYear),
    source: options.source ?? YC_SOURCE_URL,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    firstYear: YC_FIRST_YEAR,
    lastYear,
    companyCount: companies.length,
    batches: [...new Set(companies.map((company) => company.batch))].sort(),
    industries: [...new Set(companies.map((company) => company.industry))].sort(),
  };
}
