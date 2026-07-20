import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { validateCitations } from "@/lib/analysis/company-research";
import { companyResearchDraftSchema } from "@/lib/types/company-research";

describe("company research schema", () => {
  it("requires citations on every material insight", () => {
    const insight = { text: "Supported public claim", sourceIds: ["c1-yc"] };
    const draft = {
      kind: "company-research",
      title: "Acme research",
      request: "Analyze Acme",
      executiveSummary: "A sourced summary.",
      companies: [{ companyId: 1, name: "Acme", slug: "acme", batch: "W26", industry: "B2B", location: "SF", website: "https://acme.example", overview: insight, product: insight, customers: insight, businessModel: insight, signals: [insight], unknowns: [], semanticText: "Acme makes software." }],
      comparison: { sharedPatterns: [insight], differentiators: [], opportunities: [], risks: [] },
      sources: [{ id: "c1-yc", companyId: 1, kind: "yc-profile", title: "Acme — YC", url: "https://www.ycombinator.com/companies/acme", retrievedAt: new Date().toISOString(), status: "ok" }],
      warnings: [],
      methodology: "Public sources only.",
      generatedAt: new Date().toISOString(),
    };
    const parsed = companyResearchDraftSchema.parse(draft);
    expect(() => validateCitations(parsed)).not.toThrow();
    expect(companyResearchDraftSchema.safeParse({ ...draft, companies: [{ ...draft.companies[0], overview: { text: "Unsupported", sourceIds: [] } }] }).success).toBe(false);
    expect(() => validateCitations(companyResearchDraftSchema.parse({ ...draft, companies: [{ ...draft.companies[0], overview: { text: "Unsupported", sourceIds: ["unknown"] } }] }))).toThrow("COMPANY_RESEARCH_INVALID_CITATION");
  });
});
