import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { YcCompany } from "@/lib/types/company";

describe("public YC dataset", () => {
  const companies = JSON.parse(readFileSync("public/data/yc-companies.json", "utf8")) as YcCompany[];
  it("contains the intended five-year public window", () => {
    expect(companies.length).toBeGreaterThan(2_500);
    expect(Math.min(...companies.map((item) => item.year))).toBe(2022);
    expect(Math.max(...companies.map((item) => item.year))).toBe(2026);
  });
  it("ships compact directory fields instead of full source descriptions", () => {
    expect(companies[0]).not.toHaveProperty("long_description");
    expect(companies[0]).toHaveProperty("targetMarket");
  });
});
