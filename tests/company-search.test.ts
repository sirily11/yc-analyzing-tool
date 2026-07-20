import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { filterYcCompanies, resolveExactYcCompanies } from "@/lib/yc/companies";
import type { YcCompany } from "@/lib/types/company";

const company = (value: Partial<YcCompany> & Pick<YcCompany, "id" | "name">): YcCompany => {
  const { id, name, ...overrides } = value;
  return ({
  id,
  name,
  slug: name.toLowerCase().replace(/\W+/g, "-"),
  website: null,
  batch: "Winter 2026",
  year: 2026,
  industry: "B2B",
  subindustry: "B2B -> Engineering",
  oneLiner: "Developer infrastructure",
  location: "San Francisco, CA, USA",
  operatingArea: "SF Bay Area",
  targetMarket: "Developers & IT",
  aiLinked: false,
  hiring: false,
  logo: null,
  x: 0.5,
  y: 0.5,
  ...overrides,
  });
};

describe("YC company search", () => {
  it("prioritizes exact names before thematic matches deterministically", () => {
    const result = filterYcCompanies([
      company({ id: 2, name: "Stripe Tools", oneLiner: "Payments tooling" }),
      company({ id: 1, name: "Stripe", oneLiner: "Payment infrastructure" }),
      company({ id: 3, name: "Other", oneLiner: "Stripe analytics" }),
    ], { query: "Stripe", limit: 10 });
    expect(result.companies.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("resolves minor name typos and filters the public location field", () => {
    const result = filterYcCompanies([
      company({ id: 1, name: "Stripe", location: "South San Francisco, CA, USA" }),
      company({ id: 2, name: "Strive", location: "London, England, United Kingdom" }),
    ], { query: "strpie", locations: ["San Francisco"], limit: 10 });
    expect(result.companies.map((item) => item.id)).toEqual([1]);
  });

  it("applies exact public-dataset filters and result caps", () => {
    const result = filterYcCompanies([
      company({ id: 1, name: "AI One", aiLinked: true, hiring: true }),
      company({ id: 2, name: "AI Two", aiLinked: true, hiring: false }),
      company({ id: 3, name: "Classic", aiLinked: false, hiring: true }),
    ], { aiLinked: true, hiring: true, industries: ["B2B"], limit: 1 });
    expect(result.total).toBe(1);
    expect(result.companies.map((item) => item.id)).toEqual([1]);
  });

  it("resolves exact IDs in request order and enforces the ten-company contract", () => {
    const companies = [company({ id: 1, name: "One" }), company({ id: 2, name: "Two" })];
    expect(resolveExactYcCompanies(companies, [2, 1, 2]).map((item) => item.id)).toEqual([2, 1]);
    expect(() => resolveExactYcCompanies(companies, [3])).toThrow("YC_COMPANY_NOT_FOUND");
    expect(() => resolveExactYcCompanies(companies, Array.from({ length: 11 }, (_, index) => index + 1))).toThrow();
  });
});
