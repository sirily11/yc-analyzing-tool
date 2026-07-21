import type { ResultSet, Row, Value } from "@libsql/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clearYcEmbeddingCache,
  companySearchInputSchema,
  getYcCompanyDatasetEvidenceByIds,
  getYcCompaniesByIds,
  loadYcCompanies,
  resolveExactYcCompanies,
  searchYcCompanies,
  YC_EMBEDDING_DIMENSIONS,
  YC_EMBEDDING_MODEL,
} from "@/lib/yc/companies";
import type { YcSqlExecutor } from "@/lib/yc/companies";
import type { YcCompany } from "@/lib/types/company";

const company = (value: Partial<YcCompany> & Pick<YcCompany, "id" | "name">): YcCompany => {
  const { id, name, ...overrides } = value;
  return {
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
  };
};

function companyRow(value: YcCompany) {
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    website: value.website,
    batch: value.batch,
    year: value.year,
    industry: value.industry,
    subindustry: value.subindustry,
    one_liner: value.oneLiner,
    location: value.location,
    operating_area: value.operatingArea,
    target_market: value.targetMarket,
    ai_linked: value.aiLinked ? 1 : 0,
    hiring: value.hiring ? 1 : 0,
    logo: value.logo,
    x: value.x,
    y: value.y,
  };
}

function result(rows: Record<string, Value>[]): ResultSet {
  return {
    columns: [],
    columnTypes: [],
    rows: rows as unknown as Row[],
    rowsAffected: 0,
    lastInsertRowid: undefined,
    toJSON: () => rows,
  };
}

function manifestResult(overrides: Record<string, Value> = {}) {
  return result([{
    version: "yc-2020-2026-ytd-v1",
    source: "https://example.test/yc.json",
    generated_at: "2026-07-20T00:00:00.000Z",
    first_year: 2020,
    last_year: 2026,
    company_count: 2,
    batches: JSON.stringify(["Winter 2026"]),
    industries: JSON.stringify(["B2B"]),
    embedding_model: YC_EMBEDDING_MODEL,
    embedding_dimensions: YC_EMBEDDING_DIMENSIONS,
    ...overrides,
  }]);
}

function mockExecutor(...results: ResultSet[]) {
  const execute = vi.fn();
  for (const value of results) execute.mockResolvedValueOnce(value);
  return { execute, executor: { execute } as unknown as YcSqlExecutor };
}

describe("YC company database search", () => {
  beforeEach(() => clearYcEmbeddingCache());

  it("uses a query embedding and exact SQL filters for cosine-ranked natural-language search", async () => {
    const first = company({ id: 10, name: "Clinical Infra", year: 2020, industry: "Healthcare" });
    const second = company({ id: 11, name: "Care Ops", year: 2020, industry: "Healthcare" });
    const { execute, executor } = mockExecutor(
      manifestResult(),
      result([companyRow(first), companyRow(second)]),
    );
    const embedding = Array.from({ length: YC_EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0);
    const embed = vi.fn().mockResolvedValue(embedding);

    const search = await searchYcCompanies({
      query: "  Infrastructure FOR doctors  ",
      years: [2020],
      industries: ["Healthcare"],
      locations: ["San Francisco"],
      limit: 10,
    }, { executor, embed });

    expect(embed).toHaveBeenCalledWith("infrastructure for doctors", YC_EMBEDDING_MODEL);
    expect(search).toEqual({ total: 2, companies: [first, second] });
    const semanticStatement = execute.mock.calls[1][0] as { sql: string; args: Value[] };
    expect(semanticStatement.sql).toContain("vector_distance_cos(embedding, vector32(?))");
    expect(semanticStatement.sql).toContain("year IN (?) AND industry IN (?)");
    expect(semanticStatement.sql).toContain("instr(lower(location), ?) > 0");
    expect(semanticStatement.sql).toContain("ORDER BY semantic_distance ASC");
    expect(semanticStatement.args.slice(1)).toEqual([2020, "Healthcare", "san francisco", YC_EMBEDDING_MODEL, 10]);
  });

  it("caches successful normalized embeddings but still applies each request's database filters", async () => {
    const execute = vi.fn(async (statement: { sql: string }) => {
      if (statement.sql.includes("yc_dataset_manifest")) return manifestResult();
      if (statement.sql.includes("count(*)")) return result([{ total: 0 }]);
      return result([]);
    });
    const executor = { execute } as unknown as YcSqlExecutor;
    const embed = vi.fn().mockResolvedValue(new Array(YC_EMBEDDING_DIMENSIONS).fill(0.25));

    await searchYcCompanies({ query: "AI  tools", years: [2025], limit: 5 }, { executor, embed });
    await searchYcCompanies({ query: " ai tools ", years: [2026], limit: 5 }, { executor, embed });

    expect(embed).toHaveBeenCalledTimes(1);
    const semanticStatements = execute.mock.calls
      .map(([statement]) => statement as { sql: string; args: Value[] })
      .filter((statement) => statement.sql.includes("vector_distance_cos"));
    expect(semanticStatements[0].args.at(-3)).toBe(2025);
    expect(semanticStatements[1].args.at(-3)).toBe(2026);
  });

  it("does not cache embedding failures", async () => {
    const execute = vi.fn(async (statement: { sql: string }) => {
      if (statement.sql.includes("yc_dataset_manifest")) return manifestResult();
      if (statement.sql.includes("count(*)")) return result([{ total: 0 }]);
      return result([]);
    });
    const executor = { execute } as unknown as YcSqlExecutor;
    const embed = vi.fn()
      .mockRejectedValueOnce(new Error("gateway unavailable"))
      .mockResolvedValueOnce(new Array(YC_EMBEDDING_DIMENSIONS).fill(0.5));

    await expect(searchYcCompanies({ query: "robotic kitchens", limit: 5 }, { executor, embed }))
      .rejects.toThrow("gateway unavailable");
    await expect(searchYcCompanies({ query: "robotic kitchens", limit: 5 }, { executor, embed }))
      .resolves.toEqual({ total: 0, companies: [] });
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("rejects a dataset embedded with a different model before searching", async () => {
    const { executor } = mockExecutor(manifestResult({ embedding_model: "different/model" }));
    const embed = vi.fn();
    await expect(searchYcCompanies({ query: "payments for exporters", limit: 5 }, { executor, embed }))
      .rejects.toThrow("YC_EMBEDDING_MODEL_MISMATCH:different/model");
    expect(embed).not.toHaveBeenCalled();
  });

  it("lists filtered companies from Turso without invoking embedding search", async () => {
    const match = company({ id: 1, name: "AI One", aiLinked: true, hiring: true });
    const { execute, executor } = mockExecutor(result([companyRow(match)]));
    const companies = await loadYcCompanies({ industries: ["B2B"], aiLinked: true, hiring: true }, { executor });
    expect(companies).toEqual([match]);
    expect((execute.mock.calls[0][0] as { sql: string }).sql).not.toContain("LIMIT");
    expect((execute.mock.calls[0][0] as { sql: string }).sql).not.toContain("vector_distance_cos");
  });

  it("resolves exact IDs in request order and enforces the ten-company contract", async () => {
    const one = company({ id: 1, name: "One" });
    const two = company({ id: 2, name: "Two" });
    const { executor } = mockExecutor(result([companyRow(one), companyRow(two)]));
    await expect(getYcCompaniesByIds([2, 1, 2], { executor })).resolves.toEqual([two, one]);
    expect(() => resolveExactYcCompanies([one, two], [3])).toThrow("YC_COMPANY_NOT_FOUND");
    expect(() => resolveExactYcCompanies([one, two], Array.from({ length: 11 }, (_, index) => index + 1))).toThrow();
  });

  it("loads report fallback evidence from the stored YC dataset in request order", async () => {
    const { execute, executor } = mockExecutor(result([
      { id: 1, long_description: "One builds developer tooling.", tags: JSON.stringify(["Developer Tools", "SaaS"]) },
      { id: 2, long_description: "Two automates finance operations.", tags: JSON.stringify(["Fintech"]) },
    ]));
    await expect(getYcCompanyDatasetEvidenceByIds([2, 1, 2], { executor })).resolves.toEqual([
      { companyId: 2, longDescription: "Two automates finance operations.", tags: ["Fintech"] },
      { companyId: 1, longDescription: "One builds developer tooling.", tags: ["Developer Tools", "SaaS"] },
    ]);
    expect((execute.mock.calls[0][0] as { sql: string }).sql).toContain("SELECT id, long_description, tags FROM yc_companies");
  });

  it("accepts every dataset year from 2020 through the current UTC year", () => {
    const currentYear = new Date().getUTCFullYear();
    expect(companySearchInputSchema.parse({ years: [2020, currentYear] }).years).toEqual([2020, currentYear]);
    expect(() => companySearchInputSchema.parse({ years: [2019] })).toThrow();
    expect(() => companySearchInputSchema.parse({ years: [currentYear + 1] })).toThrow();
  });
});
