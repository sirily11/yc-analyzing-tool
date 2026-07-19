import type { YcCompany } from "@/lib/types/company";

export const REPORT_MAP_WIDTH = 760;
export const REPORT_MAP_HEIGHT = 430;

export const REPORT_MAP_COLORS: Record<number, string> = {
  2022: "#d55b38",
  2023: "#b78b3d",
  2024: "#5478a8",
  2025: "#806b9f",
  2026: "#315f49",
};

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
