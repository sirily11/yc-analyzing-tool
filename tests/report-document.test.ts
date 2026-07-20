import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { pdfText, ReportPdf } from "@/lib/pdf/report-document";
import type { ReportDocument } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

const companies = [{
  id: 1,
  name: "Peer",
  slug: "peer",
  website: null,
  batch: "Winter 2025",
  year: 2025,
  industry: "B2B",
  subindustry: "Software",
  oneLiner: "A nearby company",
  location: "San Francisco, CA, USA",
  operatingArea: "SF Bay Area",
  targetMarket: "Business teams",
  aiLinked: true,
  hiring: false,
  logo: null,
  x: .52,
  y: .48,
}] satisfies YcCompany[];

describe("PDF report text", () => {
  it("renders missing runtime values instead of throwing", () => {
    expect(pdfText(null)).toBe("Not provided");
    expect(pdfText(undefined)).toBe("Not provided");
    expect(pdfText("")).toBe("Not provided");
  });

  it("normalizes unsupported dash characters", () => {
    expect(pdfText("one\u2011two\u2013three\u2014four")).toBe("one-two-three-four");
  });

  it("renders a PDF when persisted report text contains null", async () => {
    const report = {
      title: "Acme report",
      executiveSummary: "Summary",
      profile: {
        companyName: "Acme",
        summary: "Profile summary",
        sector: "Software",
        subindustry: null,
        targetCustomer: null,
        businessModel: "SaaS",
        productModality: "Web app",
        stage: "Pre-seed",
      },
      prediction: {
        score: 70,
        band: "Promising",
        coverage: "medium",
        clusterPoint: { x: .5, y: .5 },
        factors: [{ label: "Market", value: null, impact: "neutral" }],
        datasetVersion: "test-dataset",
        modelVersion: "test-model",
      },
      comparableCompanies: [{ id: 1, name: "Peer", oneLiner: null, similarity: .8 }],
      strengths: [null],
      gaps: ["Clarify traction"],
      recommendations: [{ priority: 1, title: "Add evidence", detail: null }],
      methodology: "Method",
      disclaimer: null,
    } as unknown as ReportDocument;

    const buffer = await renderToBuffer(ReportPdf({ report, companies }));
    expect(buffer.byteLength).toBeGreaterThan(1_000);
  });

  it("separates founder-aware profile and analog content into dedicated pages", async () => {
    const report = {
      title: "Acme report",
      executiveSummary: "Summary",
      profile: {
        companyName: "Acme",
        summary: "Profile summary",
        sector: "Software",
        subindustry: "Infrastructure",
        targetCustomer: "Business teams",
        businessModel: "SaaS",
        productModality: "Web app",
        stage: "Pre-seed",
        founderProfile: {
          capabilityDomains: ["software"],
          domainExperience: "direct",
          technicalCapability: "demonstrated",
          teamComplementarity: "unknown",
        },
      },
      prediction: {
        score: 70,
        band: "Promising",
        coverage: "medium",
        clusterPoint: { x: .5, y: .5 },
        factors: [{ label: "Market", value: "Promising", impact: "positive" }],
        datasetVersion: "test-dataset",
        modelVersion: "test-model",
      },
      comparableCompanies: [{ id: 1, name: "Peer", oneLiner: "A nearby company", similarity: .8 }],
      strengths: ["Clear product direction"],
      gaps: ["Clarify traction"],
      recommendations: [{ priority: 1, title: "Add evidence", detail: "Quantify customer adoption." }],
      methodology: "Method",
      disclaimer: "Independent analysis.",
    } as unknown as ReportDocument;

    const buffer = await renderToBuffer(ReportPdf({ report, companies }));
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    expect(pdf.numPages).toBe(5);
    await loadingTask.destroy();
  });
});
