import { describe, expect, it } from "vitest";
import { projectReportMapPoint, selectReportMapCompanies } from "@/lib/report-map";
import type { YcCompany } from "@/lib/types/company";

const company = (id: number, x: number, y: number) => ({ id, x, y }) as YcCompany;

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
});
