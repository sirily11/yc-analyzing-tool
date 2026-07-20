import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { resolveReportModel } from "@/config";
import { normalizeReportDraft } from "@/lib/analysis/report-draft";
import { buildReportDocument } from "@/lib/analysis/report";
import { publicHttpsUrl, startWebsiteCrawl, verifyFirecrawlSignature } from "@/lib/research/firecrawl";
import { reportDocumentSchema, type ApplicationProfile, type ExtractedPdf, type GeneratedReportDraft, type PredictionResult } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

const profile: ApplicationProfile = {
  companyName: "Acme",
  summary: "Acme helps operations teams automate a measurable workflow.",
  sector: "B2B",
  subindustry: "Software",
  targetCustomer: "Business teams",
  businessModel: "SaaS",
  productModality: "Software product",
  geography: "United States",
  aiLinked: true,
  teamSizeBand: "Two founders",
  stage: "Early traction",
  tractionSignals: ["Three paid pilots are described."],
  missingFields: ["retention"],
  evidencePages: [2],
  extractionCoverage: 0.72,
  founderProfile: {
    founderCountBand: "two",
    capabilityDomains: ["software", "operations"],
    domainExperience: "direct",
    technicalCapability: "demonstrated",
    priorBuildingExperience: "stated",
    teamComplementarity: "demonstrated",
    evidencePages: [3],
    missingFields: [],
    coverage: 0.8,
  },
};

const prediction: PredictionResult = {
  scoreKind: "fit",
  score: 68,
  band: "Promising",
  coverage: "medium",
  reconstructionPercentile: 0.68,
  scoreComponents: { startupFit: 70, founderFit: 63, startupWeight: 0.7, founderWeight: 0.3 },
  nearestCompanyIds: [1],
  clusterPoint: { x: 0.5, y: 0.5 },
  factors: [{ label: "Startup fit", value: "70/100", impact: "positive" }],
  warnings: ["Not an acceptance probability."],
  modelVersion: "browser-fit-v2",
  datasetVersion: "test-dataset",
};

const company: YcCompany = {
  id: 1,
  name: "Peer",
  slug: "peer",
  website: "https://peer.example",
  batch: "Winter 2025",
  year: 2025,
  industry: "B2B",
  subindustry: "Software",
  oneLiner: "Software for operations teams",
  location: "San Francisco, CA, USA",
  operatingArea: "SF Bay Area",
  targetMarket: "Business teams",
  aiLinked: true,
  hiring: false,
  logo: null,
  x: 0.5,
  y: 0.5,
};

function generatedDraft(): GeneratedReportDraft {
  return {
    executiveNarrative: "The application has a clear workflow and needs stronger retention proof.",
    scoreInterpretation: "The score is a fit signal.",
    candidateEvidence: [
      { claim: "Paid pilots are evidenced.", sourceLabel: "wrong", page: 2 },
      { claim: "This unsupported claim has an invalid page.", sourceLabel: "wrong", page: 99 },
    ],
    diagnosis: { marketCustomer: "Specific", product: "Clear", traction: "Early", founders: "Relevant", readiness: "Needs proof" },
    comparisonMatrix: [{ companyId: 1, companyName: "Invented name", product: "Product", customer: "Customer", businessModel: "SaaS", traction: "Early", founders: "Professional evidence", similarity: "Workflow", difference: "Stage", lesson: "Quantify proof", sourceIds: ["S01", "invented"] }],
    companyDeepDives: [{ companyId: 1, companyName: "Invented name", overview: "Overview", websiteAnalysis: "Website", founderAnalysis: "Founders", tractionAnalysis: "Traction", similarities: ["Similar"], differences: ["Different"], lessons: ["Lesson"], sourceIds: ["invented", "S01"] }],
    strengths: ["Clear workflow"],
    risks: [{ title: "Retention", detail: "Not evidenced", evidenceToAdd: "Cohort data" }],
    recommendations: [{ priority: 4, title: "Add proof", action: "Add retention", rationale: "It reduces risk", proofToAdd: "Cohorts", suggestedFraming: "State the period and denominator" }],
    actionPlan: [
      { period: "Days 1–7", focus: "Audit", actions: ["Audit claims"] },
      { period: "Days 8–14", focus: "Validate", actions: ["Talk to users"] },
      { period: "Days 15–21", focus: "Rewrite", actions: ["Rewrite"] },
      { period: "Days 22–30", focus: "Test", actions: ["Stress test"] },
    ],
  };
}

describe("research-enriched reports", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves the dedicated drafting model before analysis and chat fallbacks", () => {
    expect(resolveReportModel({ AI_REPORT_MODEL: "report", AI_ANALYSIS_MODEL: "analysis", AI_CHAT_MODEL: "chat" })).toBe("report");
    expect(resolveReportModel({ AI_ANALYSIS_MODEL: "analysis", AI_CHAT_MODEL: "chat" })).toBe("analysis");
    expect(resolveReportModel({ AI_CHAT_MODEL: "chat" })).toBe("chat");
    expect(resolveReportModel({})).toBe("openai/gpt-5-mini");
  });

  it("accepts only public HTTPS research targets", () => {
    expect(publicHttpsUrl("https://example.com/path#fragment")).toBe("https://example.com/path");
    expect(publicHttpsUrl("http://example.com")).toBeNull();
    expect(publicHttpsUrl("https://127.0.0.1/private")).toBeNull();
    expect(publicHttpsUrl("https://192.168.1.5/private")).toBeNull();
    expect(publicHttpsUrl("https://user:secret@example.com")).toBeNull();
  });

  it("verifies Firecrawl webhook signatures against the raw body", () => {
    const body = JSON.stringify({ id: "job-1", type: "crawl.completed" });
    const secret = "webhook-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyFirecrawlSignature(body, signature, secret)).toBe(true);
    expect(verifyFirecrawlSignature(`${body} `, signature, secret)).toBe(false);
  });

  it("starts a constrained, robots-aware website crawl with the signed callback", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    vi.stubEnv("FIRECRAWL_WEBHOOK_SECRET", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, id: "crawl-job" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWebsiteCrawl("report-1", company)).resolves.toMatchObject({ firecrawlJobId: "crawl-job" });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      url: "https://peer.example/",
      maxDiscoveryDepth: 1,
      limit: 5,
      allowExternalLinks: false,
      allowSubdomains: false,
      ignoreRobotsTxt: false,
      scrapeOptions: { maxAge: 86_400_000, onlyMainContent: true },
      webhook: {
        url: "https://app.example/api/webhooks/firecrawl",
        metadata: { reportId: "report-1" },
      },
    });
  });

  it("removes invented citations and invalid PDF pages while locking company identity", () => {
    const source: ExtractedPdf = {
      metadata: { kind: "pdf", name: "acme.pdf", size: 10, pages: 2, characters: 10, sha256: "a".repeat(64) },
      pages: [{ page: 1, text: "Intro" }, { page: 2, text: "Three paid pilots" }],
      text: "Intro Three paid pilots",
    };
    const normalized = normalizeReportDraft(generatedDraft(), source, [company], [{ id: "S01", companyId: 1, title: "Peer", url: "https://peer.example", sourceType: "company-website", publishedAt: null, accessedAt: new Date().toISOString() }]);
    expect(normalized.candidateEvidence).toEqual([{ claim: "Paid pilots are evidenced.", sourceLabel: "Page 2", page: 2 }]);
    expect(normalized.comparisonMatrix[0]).toMatchObject({ companyName: "Peer", sourceIds: ["S01"] });
    expect(normalized.companyDeepDives[0]).toMatchObject({ companyName: "Peer", sourceIds: ["S01"] });
    expect(normalized.recommendations[0].priority).toBe(1);
  });

  it("builds a backward-readable version 2 document without changing the locked prediction", () => {
    const report = buildReportDocument(profile, prediction, [company]);
    expect(reportDocumentSchema.parse(report).schemaVersion).toBe(2);
    expect(report.prediction).toBe(prediction);
    expect(report.prediction.score).toBe(68);
    expect(report.dossier?.actionPlan).toHaveLength(4);
    expect(report.dossier?.researchSources[0].url).toContain("ycombinator.com/companies/peer");
  });
});
