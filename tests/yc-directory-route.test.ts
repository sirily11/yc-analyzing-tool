import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/yc/companies", () => ({
  loadYcCompanies: vi.fn(),
  loadYcDatasetManifest: vi.fn(),
  searchYcCompanies: vi.fn(),
}));
vi.mock("@/lib/yc/search-rate-limit", () => ({
  consumeYcSemanticSearchLimit: vi.fn(),
}));

import { GET } from "@/app/api/yc/companies/route";
import { loadYcCompanies, loadYcDatasetManifest, searchYcCompanies } from "@/lib/yc/companies";
import { consumeYcSemanticSearchLimit } from "@/lib/yc/search-rate-limit";

const manifest = {
  version: "yc-2020-2026-ytd-v3",
  source: "https://yc-oss.github.io/api/companies/all.json",
  generatedAt: "2026-07-20T00:00:00.000Z",
  firstYear: 2020,
  lastYear: 2026,
  companyCount: 4_019,
  batches: ["Winter 2020", "Fall 2026"],
  industries: ["B2B"],
  embeddingModel: "openai/text-embedding-3-small",
  embeddingDimensions: 1_536,
};

describe("public YC directory route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadYcDatasetManifest).mockResolvedValue(manifest);
    vi.mocked(loadYcCompanies).mockResolvedValue([]);
    vi.mocked(searchYcCompanies).mockResolvedValue({ companies: [], total: 0 });
    vi.mocked(consumeYcSemanticSearchLimit).mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      retryAfterSeconds: 60,
    });
  });

  it("sends natural-language queries and exact filters to semantic DB search", async () => {
    const response = await GET(new Request("https://example.test/api/yc/companies?query=warehouse%20automation&year=2020&industry=B2B"));

    expect(response.status).toBe(200);
    expect(searchYcCompanies).toHaveBeenCalledWith({
      query: "warehouse automation",
      years: [2020],
      industries: ["B2B"],
      targetMarkets: undefined,
      operatingAreas: undefined,
      limit: 50,
    });
    expect(loadYcCompanies).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ companies: [], total: 0, manifest });
  });

  it("lists filtered companies from Turso without generating a query embedding", async () => {
    const response = await GET(new Request("https://example.test/api/yc/companies?targetMarket=Developers%20%26%20IT&operatingArea=SF%20Bay%20Area"));

    expect(response.status).toBe(200);
    expect(loadYcCompanies).toHaveBeenCalledWith({
      years: undefined,
      industries: undefined,
      targetMarkets: ["Developers & IT"],
      operatingAreas: ["SF Bay Area"],
    });
    expect(searchYcCompanies).not.toHaveBeenCalled();
  });

  it("rejects next-year placeholder batches before querying the database", async () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    const response = await GET(new Request(`https://example.test/api/yc/companies?year=${nextYear}`));

    expect(response.status).toBe(400);
    expect(loadYcCompanies).not.toHaveBeenCalled();
    expect(searchYcCompanies).not.toHaveBeenCalled();
  });

  it("rate-limits paid anonymous semantic queries before embedding", async () => {
    vi.mocked(consumeYcSemanticSearchLimit).mockResolvedValue({
      allowed: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 17,
    });
    const response = await GET(new Request("https://example.test/api/yc/companies?query=warehouse%20automation"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(searchYcCompanies).not.toHaveBeenCalled();
    expect(loadYcDatasetManifest).not.toHaveBeenCalled();
  });
});
