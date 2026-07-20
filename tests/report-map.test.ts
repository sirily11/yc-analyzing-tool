import { describe, expect, it } from "vitest";
import {
  companyReportMapNodes,
  filterReportMapCompanies,
  projectReportMapPoint,
  reportMapColor,
  reportMapYears,
  selectReportMapCompanies,
  toggleReportMapYear,
} from "@/lib/report-map";
import type { CompanyClusterMap } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";

const company = (id: number, x: number, y: number, year = 2024) => ({ id, x, y, year }) as YcCompany;

describe("report map", () => {
  it("uses the closest real company positions", () => {
    const nodes = selectReportMapCompanies([
      company(1, .1, .1),
      company(2, .51, .49),
      company(3, .8, .8),
    ], { x: .5, y: .5 }, 2);

    expect(nodes.map(({ company: item }) => item.id)).toEqual([2, 3]);
  });

  it("projects normalized coordinates into the shared web and PDF view box", () => {
    expect(projectReportMapPoint({ x: 0, y: 0 })).toEqual({ x: 15, y: 25 });
    expect(projectReportMapPoint({ x: 1, y: 1 })).toEqual({ x: 745, y: 415 });
  });

  it("derives real directory years and supports multi-year filtering", () => {
    const companies = [company(1, 0, 0, 2024), company(2, 0, 0, 2026), company(3, 0, 0, 2024), company(4, 0, 0, 2021)];
    expect(reportMapYears(companies)).toEqual([2026, 2024, 2021]);
    expect(filterReportMapCompanies(companies, [2021, 2026]).map(({ id }) => id)).toEqual([2, 4]);
    expect(filterReportMapCompanies(companies, [])).toBe(companies);
  });

  it("uses an empty selection for all years and toggles multiple years", () => {
    expect(toggleReportMapYear([], 2026)).toEqual([2026]);
    expect(toggleReportMapYear([2026], 2024)).toEqual([2026, 2024]);
    expect(toggleReportMapYear([2026, 2024], 2026)).toEqual([2024]);
    expect(toggleReportMapYear([2024], 2024)).toEqual([]);
  });

  it("provides colors for the full directory range and future years", () => {
    expect(reportMapColor(2020)).not.toBe("#70695f");
    expect(reportMapColor(2021)).not.toBe(reportMapColor(2020));
    expect(reportMapColor(2031)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(reportMapColor(2031)).toBe(reportMapColor(2024));
  });

  it("switches company reports from stored cluster coordinates to global coordinates", () => {
    const companies = [
      company(1, .11, .12, 2022),
      company(2, .21, .22, 2023),
      company(3, .31, .32, 2024),
    ];
    const map: CompanyClusterMap = {
      mode: "semantic",
      algorithm: "umap",
      seed: 42,
      modelWeight: .7,
      webWeight: .3,
      embeddingModel: "embedding",
      modelVersion: "model",
      datasetVersion: "dataset",
      warning: null,
      points: [
        { companyId: 1, x: .81, y: .82, target: true, textSource: "firecrawl" },
        { companyId: 2, x: .41, y: .42, target: false, textSource: "dataset" },
      ],
    };

    const cluster = companyReportMapNodes(map, companies, "cluster", [2024]);
    expect(cluster).toMatchObject([{ company: { id: 1 }, point: { x: .81, y: .82, target: true } }]);

    const all = companyReportMapNodes(map, companies, "all", [2024]);
    expect(all).toMatchObject([
      { company: { id: 1 }, point: { x: .11, y: .12, target: true } },
      { company: { id: 3 }, point: { x: .31, y: .32, target: false } },
    ]);
  });
});
