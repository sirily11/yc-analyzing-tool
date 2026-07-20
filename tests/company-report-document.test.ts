import { renderToBuffer } from "@react-pdf/renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ getCompanyResearchReport: vi.fn() }));
vi.mock("@/lib/yc/companies", () => ({ loadYcCompanies: vi.fn() }));

import { GET } from "@/app/api/company-reports/[reportId]/pdf/route";
import { getCurrentUser } from "@/lib/auth";
import { getCompanyResearchReport } from "@/lib/db/repository";
import { CompanyResearchReportPdf } from "@/lib/pdf/company-report-document";
import { companyResearchReportDocumentSchema } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";
import { loadYcCompanies } from "@/lib/yc/companies";

const companies = [
  {
    id: 42,
    name: "Acme",
    slug: "acme",
    website: "https://acme.example",
    batch: "W26",
    year: 2026,
    industry: "B2B",
    subindustry: "Operations",
    oneLiner: "AI operations software for industrial teams",
    location: "San Francisco, CA, USA",
    operatingArea: "SF Bay Area",
    targetMarket: "Enterprise",
    aiLinked: true,
    hiring: true,
    logo: null,
    x: .48,
    y: .52,
  },
  {
    id: 43,
    name: "Peer",
    slug: "peer",
    website: null,
    batch: "S25",
    year: 2025,
    industry: "B2B",
    subindustry: "Software",
    oneLiner: "Workflow software",
    location: "New York, NY, USA",
    operatingArea: "United States",
    targetMarket: "Enterprise",
    aiLinked: false,
    hiring: false,
    logo: null,
    x: .56,
    y: .45,
  },
] satisfies YcCompany[];

const insight = { text: "Acme converts public operational data into workflow recommendations.", sourceIds: ["c42-yc"] };
const report = companyResearchReportDocumentSchema.parse({
  kind: "company-research",
  title: "Acme public company research",
  request: "Analyze Acme's product, customers, business model, public signals, risks, and important unknowns.",
  executiveSummary: "Acme presents a focused enterprise workflow product with a clear operational buyer. Public evidence supports the product direction, while adoption depth remains an important unknown.",
  companies: [{
    companyId: 42,
    name: "Acme",
    slug: "acme",
    batch: "W26",
    industry: "B2B",
    location: "San Francisco, CA, USA",
    website: "https://acme.example",
    overview: insight,
    product: { text: "A browser-based operational intelligence product.", sourceIds: ["c42-site1"] },
    customers: { text: "Industrial operations and enterprise workflow teams.", sourceIds: ["c42-yc"] },
    businessModel: { text: "Public materials indicate enterprise software pricing.", sourceIds: ["c42-site1"] },
    signals: [{ text: "The official site publishes a focused set of enterprise use cases.", sourceIds: ["c42-site1"] }],
    unknowns: ["Customer count and retained revenue are not publicly disclosed."],
    semanticText: "Acme provides AI operational intelligence for industrial enterprise teams.",
  }],
  comparison: {
    sharedPatterns: [insight],
    differentiators: [{ text: "Acme emphasizes industrial workflows rather than general productivity.", sourceIds: ["c42-site1"] }],
    opportunities: [{ text: "Published use cases could be paired with quantified customer outcomes.", sourceIds: ["c42-site1"] }],
    risks: [{ text: "Public materials do not establish repeatable adoption.", sourceIds: ["c42-yc"] }],
  },
  sources: [
    { id: "c42-yc", companyId: 42, kind: "yc-profile", title: "Acme - Y Combinator", url: "https://www.ycombinator.com/companies/acme", retrievedAt: "2026-07-20T08:00:00.000Z", status: "ok" },
    { id: "c42-site1", companyId: 42, kind: "official-site", title: "Acme official website", url: "https://acme.example", retrievedAt: "2026-07-20T08:00:00.000Z", status: "ok" },
  ],
  warnings: ["Revenue and customer retention were not available in public sources."],
  methodology: "The report combines the versioned YC directory snapshot with time-stamped public website research. Each material claim cites the public source index.",
  generatedAt: "2026-07-20T08:00:00.000Z",
  map: {
    mode: "semantic",
    algorithm: "umap",
    seed: 42,
    modelWeight: .7,
    webWeight: .3,
    embeddingModel: "test-embedding",
    modelVersion: "browser-fit-v2",
    datasetVersion: "yc-2026",
    warning: null,
    points: [
      { companyId: 42, x: .45, y: .52, target: true, textSource: "firecrawl" },
      { companyId: 43, x: .57, y: .46, target: false, textSource: "dataset" },
    ],
  },
});

const reportId = "5d8f157e-802b-4b51-8f9c-4943863c0dc9";

describe("company research PDF", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the company research document", async () => {
    const buffer = await renderToBuffer(CompanyResearchReportPdf({ report, companies }));
    expect(buffer.byteLength).toBeGreaterThan(4_000);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("requires authentication for downloads", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await GET(new Request("https://example.test"), { params: Promise.resolve({ reportId }) });
    expect(response.status).toBe(404);
  });

  it("returns an owned completed report as a private attachment", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "owner", name: "Owner", email: "owner@example.com", roles: [] });
    vi.mocked(getCompanyResearchReport).mockResolvedValue({ status: "complete", document: report } as never);
    vi.mocked(loadYcCompanies).mockResolvedValue(companies);

    const response = await GET(new Request("https://example.test"), { params: Promise.resolve({ reportId }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="acme-company-research.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(4_000);
    expect(getCompanyResearchReport).toHaveBeenCalledWith("owner", reportId);
  });
});
