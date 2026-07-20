import { describe, expect, it } from "vitest";
import {
  createYcDatasetManifest,
  currentUtcYear,
  normalizeYcCompanies,
  YC_FIRST_YEAR,
} from "@/lib/yc/source";

const sourceCompany = (id: number, batch: string) => ({
  id,
  name: `Company ${id}`,
  slug: `company-${id}`,
  batch,
  industry: "B2B",
  one_liner: "Workflow software",
});

describe("YC source window", () => {
  it("normalizes 2020 through the current UTC year without requiring a checked-in export", () => {
    const lastYear = currentUtcYear(new Date("2026-07-20T00:00:00Z"));
    const companies = normalizeYcCompanies([
      sourceCompany(1, "Winter 2019"),
      sourceCompany(2, "Winter 2020"),
      sourceCompany(3, "2026-Fall"),
      sourceCompany(4, "Winter 2027"),
    ], { lastYear });

    expect(companies.map((company) => company.id)).toEqual([3, 2]);
    expect(Math.min(...companies.map((company) => company.year))).toBe(YC_FIRST_YEAR);
    expect(Math.max(...companies.map((company) => company.year))).toBe(lastYear);
  });

  it("builds the stable dynamic dataset version from the current UTC window", () => {
    const companies = normalizeYcCompanies([
      sourceCompany(2, "Winter 2020"),
      sourceCompany(3, "2026-Fall"),
    ], { lastYear: 2026 });
    const manifest = createYcDatasetManifest(companies, {
      generatedAt: new Date("2026-07-20T00:00:00Z"),
    });

    expect(manifest).toMatchObject({
      version: "yc-2020-2026-ytd-v3",
      firstYear: 2020,
      lastYear: 2026,
      companyCount: 2,
      batches: ["2026-Fall", "Winter 2020"],
    });
  });
});
