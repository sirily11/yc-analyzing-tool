import type { YcCompany } from "@/lib/types/company";
import type { CompanyClusterMap } from "@/lib/types/company-research";

export const REPORT_MAP_WIDTH = 760;
export const REPORT_MAP_HEIGHT = 430;

export type ReportMapScope = "cluster" | "all";

export const REPORT_MAP_COLORS: Record<number, string> = {
  2020: "#846654",
  2021: "#3d827f",
  2022: "#d55b38",
  2023: "#b78b3d",
  2024: "#5478a8",
  2025: "#806b9f",
  2026: "#315f49",
};

const REPORT_MAP_COLOR_PALETTE = Object.values(REPORT_MAP_COLORS);

export function reportMapColor(year: number) {
  return REPORT_MAP_COLORS[year]
    ?? REPORT_MAP_COLOR_PALETTE[Math.abs(year - 2020) % REPORT_MAP_COLOR_PALETTE.length];
}

export function reportMapYears(companies: YcCompany[]) {
  return [...new Set(companies.map((company) => company.year))].sort((left, right) => right - left);
}

export function filterReportMapCompanies(companies: YcCompany[], selectedYears: readonly number[]) {
  if (!selectedYears.length) return companies;
  const years = new Set(selectedYears);
  return companies.filter((company) => years.has(company.year));
}

export function toggleReportMapYear(selectedYears: readonly number[], year: number) {
  if (!selectedYears.length) return [year];
  if (selectedYears.length === 1 && selectedYears[0] === year) return [];
  return selectedYears.includes(year)
    ? selectedYears.filter((selectedYear) => selectedYear !== year)
    : [...selectedYears, year].sort((left, right) => right - left);
}

export type CompanyReportMapNode = {
  company: YcCompany;
  point: CompanyClusterMap["points"][number];
};

export function companyReportMapNodes(map: CompanyClusterMap, companies: YcCompany[], scope: ReportMapScope, selectedYears: readonly number[]) {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const targetIds = new Set(map.points.filter((point) => point.target).map((point) => point.companyId));
  const points = scope === "cluster" ? map.points : companies.map((company) => ({
    companyId: company.id,
    x: company.x,
    y: company.y,
    target: targetIds.has(company.id),
    textSource: "dataset" as const,
  }));
  const years = new Set(selectedYears);
  return points.flatMap((point) => {
    const company = companyById.get(point.companyId);
    return company && (point.target || !years.size || years.has(company.year)) ? [{ point, company }] : [];
  });
}

export function selectReportMapCompanies(companies: YcCompany[], center: { x: number; y: number }, limit = 180) {
  return companies
    .map((company) => ({ company, distance: Math.hypot(company.x - center.x, company.y - center.y) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export function projectReportMapPoint(point: { x: number; y: number }, width = REPORT_MAP_WIDTH, height = REPORT_MAP_HEIGHT) {
  return {
    x: ((point.x * 730 + 15) / REPORT_MAP_WIDTH) * width,
    y: ((point.y * 390 + 25) / REPORT_MAP_HEIGHT) * height,
  };
}
