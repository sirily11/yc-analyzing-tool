import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { YcCompany } from "@/lib/types/company";

export const companySearchInputSchema = z.object({
  query: z.string().max(200).optional(),
  years: z.array(z.number().int().min(2022).max(2026)).max(5).optional(),
  batches: z.array(z.string().min(1).max(80)).max(20).optional(),
  industries: z.array(z.string().min(1).max(120)).max(20).optional(),
  targetMarkets: z.array(z.string().min(1).max(120)).max(20).optional(),
  locations: z.array(z.string().min(1).max(120)).max(20).optional(),
  operatingAreas: z.array(z.string().min(1).max(120)).max(20).optional(),
  aiLinked: z.boolean().optional(),
  hiring: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type CompanySearchInput = z.infer<typeof companySearchInputSchema>;
export const exactCompanyIdsSchema = z.array(z.number().int()).min(1).max(10);

let companiesPromise: Promise<YcCompany[]> | null = null;

export function loadYcCompanies() {
  companiesPromise ??= readFile(path.join(process.cwd(), "public", "data", "yc-companies.json"), "utf8")
    .then((source) => JSON.parse(source) as YcCompany[]);
  return companiesPromise;
}

function tokens(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function searchScore(company: YcCompany, query: string) {
  if (!query) return 0;
  const normalized = query.toLowerCase().trim();
  const name = company.name.toLowerCase();
  const slug = company.slug.toLowerCase();
  const haystack = `${name} ${slug} ${company.oneLiner} ${company.industry} ${company.subindustry} ${company.targetMarket} ${company.location}`.toLowerCase();
  let score = name === normalized || slug === normalized ? 1_000 : name.startsWith(normalized) ? 500 : haystack.includes(normalized) ? 250 : 0;
  for (const token of tokens(normalized)) {
    if (name.split(/\s+/).includes(token)) score += 80;
    else if (name.includes(token) || slug.includes(token)) score += 45;
    else if (haystack.includes(token)) score += 12;
  }
  if (score === 0 && normalized.length >= 4) {
    const distance = Math.min(editDistance(normalized, name), editDistance(normalized, slug.replaceAll("-", " ")));
    if (distance <= Math.max(2, Math.floor(normalized.length * 0.25))) score = 180 - distance * 20;
  }
  return score;
}

export function filterYcCompanies(companies: YcCompany[], rawInput: CompanySearchInput) {
  const input = companySearchInputSchema.parse(rawInput);
  const query = input.query?.trim() ?? "";
  const matches = companies.filter((company) => {
    if (input.years?.length && !input.years.includes(company.year)) return false;
    if (input.batches?.length && !input.batches.includes(company.batch)) return false;
    if (input.industries?.length && !input.industries.includes(company.industry)) return false;
    if (input.targetMarkets?.length && !input.targetMarkets.includes(company.targetMarket)) return false;
    if (input.locations?.length && !input.locations.some((location) => company.location.toLowerCase().includes(location.trim().toLowerCase()))) return false;
    if (input.operatingAreas?.length && !input.operatingAreas.includes(company.operatingArea)) return false;
    if (input.aiLinked !== undefined && company.aiLinked !== input.aiLinked) return false;
    if (input.hiring !== undefined && company.hiring !== input.hiring) return false;
    return !query || searchScore(company, query) > 0;
  }).map((company) => ({ company, score: searchScore(company, query) }));

  matches.sort((left, right) => right.score - left.score || right.company.year - left.company.year || left.company.name.localeCompare(right.company.name));
  return {
    total: matches.length,
    companies: matches.slice(0, input.limit).map(({ company }) => company),
  };
}

export function resolveExactYcCompanies(companies: YcCompany[], rawIds: number[]) {
  const ids = [...new Set(exactCompanyIdsSchema.parse(rawIds))];
  const lookup = new Map(companies.map((company) => [company.id, company]));
  const resolved = ids.flatMap((id) => lookup.get(id) ?? []);
  if (resolved.length !== ids.length) throw new Error("YC_COMPANY_NOT_FOUND");
  return resolved;
}

export async function getYcCompaniesByIds(ids: number[]) {
  return resolveExactYcCompanies(await loadYcCompanies(), ids);
}
