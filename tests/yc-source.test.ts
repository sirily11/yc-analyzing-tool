import { describe, expect, it } from "vitest";
import {
  coordinateMapFromCompanies,
  deterministicCompanyCoordinates,
  directoryYcCompany,
  normalizeYcCompanies,
} from "@/lib/yc/source";

describe("YC upstream normalization", () => {
  const source = {
    id: "42",
    name: "Natural Search",
    slug: "natural-search",
    former_names: ["Old Search"],
    website: "https://www.example.com/product",
    batch: "2026-Fall",
    industry: "B2B",
    subindustry: "B2B -> Analytics",
    one_liner: "Natural-language analytics for operators",
    long_description: "Ask questions about company data without SQL.",
    all_locations: "San Francisco, CA, USA",
    regions: ["United States of America"],
    tags: ["Artificial Intelligence", "Analytics"],
    isHiring: true,
    small_logo_thumb_url: "https://example.com/logo.png",
  };

  it("keeps the stable numeric source id and builds rich semantic text", () => {
    const [company] = normalizeYcCompanies([source], { lastYear: 2026 });

    expect(company.id).toBe(42);
    expect(company.embeddingText).toContain("Company: Natural Search");
    expect(company.embeddingText).toContain("Slug: natural-search");
    expect(company.embeddingText).toContain("Former names: Old Search");
    expect(company.embeddingText).toContain("Website domain: example.com");
    expect(company.embeddingText).toContain("Long description: Ask questions about company data without SQL.");
    expect(company.embeddingText).toContain("Tags: Artificial Intelligence, Analytics");
    expect(company.embeddingText).toContain("Operating area: SF Bay Area");
    expect(company.embeddingText).toContain("Regions: United States of America");
    expect(company.embeddingText).toContain("Target market: Developers & IT");
    expect(company.embeddingText).toContain("AI-linked: yes");
    expect(company.embeddingText).toContain("Hiring: yes");
  });

  it("uses learned coordinates when present and deterministic coordinates otherwise", () => {
    const learned = coordinateMapFromCompanies([{ id: 42, x: 0.123456, y: 0.654321 }]);
    const [company] = normalizeYcCompanies([source], { lastYear: 2026, learnedCoordinates: learned });
    expect({ x: company.x, y: company.y }).toEqual({ x: 0.12346, y: 0.65432 });
    expect(deterministicCompanyCoordinates("B2B", "Developers & IT", 42)).toEqual(
      deterministicCompanyCoordinates("B2B", "Developers & IT", 42),
    );
  });

  it("keeps offline exports compact while retaining the search-only source record in memory", () => {
    const [company] = normalizeYcCompanies([source], { lastYear: 2026 });
    const exported = directoryYcCompany(company);
    expect(exported).toHaveProperty("targetMarket");
    expect(exported).not.toHaveProperty("embeddingText");
    expect(exported).not.toHaveProperty("longDescription");
    expect(exported).not.toHaveProperty("tags");
  });
});
