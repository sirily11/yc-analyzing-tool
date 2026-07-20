import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { CompanyClusterMap } from "@/components/company-cluster-map";
import { CompanyResearchProgress } from "@/components/company-research-progress";
import { requirePageUser } from "@/lib/auth";
import { getCompanyResearchReport } from "@/lib/db/repository";
import { companyResearchReportDocumentSchema } from "@/lib/types/company-research";
import { createPageMetadata } from "@/lib/site-metadata";
import { loadYcCompanies } from "@/lib/yc/companies";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ reportId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { reportId } = await params;
  return createPageMetadata("companyReport", `/company-reports/${encodeURIComponent(reportId)}`, { privatePage: true });
}

function CitedItems({ items, sourceNumbers }: { items: Array<{ text: string; sourceIds: string[] }>; sourceNumbers: Map<string, number> }) {
  return <>{items.map((item) => <article className="company-report-insight" key={`${item.text}-${item.sourceIds.join("-")}`}><p>{item.text}</p><span>{item.sourceIds.map((id) => `[${sourceNumbers.get(id) ?? "?"}]`).join(" ")}</span></article>)}</>;
}

function CitationMarks({ sourceIds, sourceNumbers }: { sourceIds: string[]; sourceNumbers: Map<string, number> }) {
  return <small>{sourceIds.map((id) => `[${sourceNumbers.get(id) ?? "?"}]`).join(" ")}</small>;
}

export default async function CompanyReportPage({ params }: PageProps) {
  const user = await requirePageUser(); const { reportId } = await params;
  const row = await getCompanyResearchReport(user.id, reportId);
  if (!row) notFound();
  if (row.status !== "complete") {
    return <CompanyResearchProgress reportId={reportId} title={row.title} initialStatus={row.status} />;
  }
  const parsed = companyResearchReportDocumentSchema.safeParse(row?.document);
  if (!parsed.success) notFound();
  const report = parsed.data;
  const companies = await loadYcCompanies();
  const sourceNumbers = new Map(report.sources.map((source, index) => [source.id, index + 1]));
  return <main className="report-page company-report-page">
    <header className="report-topbar"><Link href="/dashboard"><ArrowLeft size={15} /> Back to reports</Link><span className="brand"><span className="brand-mark">A</span> APPLICATION SIGNAL</span><div className="report-topbar-actions"><span className="privacy-pill"><ShieldCheck size={13} /> Private</span><a className="button-dark" href={`/api/company-reports/${reportId}/pdf`}><Download size={15} /> Download PDF</a></div></header>
    <section className="report-hero company-report-hero"><div><p className="eyebrow">Private YC company research · {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(row.createdAt)}</p><h1>{report.title}</h1><p>{report.executiveSummary}</p></div><div className="company-report-count"><strong>{report.companies.length}</strong><span>researched companies</span><small>{report.sources.filter((source) => source.status === "ok").length} usable public sources</small></div></section>
    <section className="report-map-section"><div className="report-section-heading"><span className="section-index">01 / Semantic position</span><h2>Explore the company landscape</h2><p>The current cluster blends versioned model signals with public website language. Switch to All YC for the live global directory layout, and filter comparison companies by YC year. Orange report companies stay visible.</p></div><CompanyClusterMap map={report.map} companies={companies} /></section>
    <section className="company-report-section"><span className="section-index">02 / Company snapshots</span><div className="company-report-profiles">{report.companies.map((company) => <article key={company.companyId}>
      <header className="company-report-profile-intro"><p className="eyebrow">{company.batch} · {company.industry}</p><h2>{company.name}</h2><p>{company.overview.text} <CitationMarks sourceIds={company.overview.sourceIds} sourceNumbers={sourceNumbers} /></p></header>
      <div className="company-report-profile-body">
        <dl><div><dt>Product</dt><dd>{company.product.text} <CitationMarks sourceIds={company.product.sourceIds} sourceNumbers={sourceNumbers} /></dd></div><div><dt>Customers</dt><dd>{company.customers.text} <CitationMarks sourceIds={company.customers.sourceIds} sourceNumbers={sourceNumbers} /></dd></div><div><dt>Business model</dt><dd>{company.businessModel.text} <CitationMarks sourceIds={company.businessModel.sourceIds} sourceNumbers={sourceNumbers} /></dd></div></dl>
        {(company.signals.length > 0 || company.unknowns.length > 0) && <div className="company-report-profile-evidence">{company.signals.length > 0 && <div className="company-report-signals"><strong>Signals</strong><CitedItems items={company.signals} sourceNumbers={sourceNumbers} /></div>}{company.unknowns.length > 0 && <div className="company-report-unknowns"><strong>Unknowns</strong>{company.unknowns.map((item) => <span key={item}>{item}</span>)}</div>}</div>}
      </div>
    </article>)}</div></section>
    <section className="company-report-comparison"><div><span className="section-index">03 / Shared patterns</span><CitedItems items={report.comparison.sharedPatterns} sourceNumbers={sourceNumbers} /></div><div><span className="section-index">04 / Differentiators</span><CitedItems items={report.comparison.differentiators} sourceNumbers={sourceNumbers} /></div><div><span className="section-index">05 / Opportunities</span><CitedItems items={report.comparison.opportunities} sourceNumbers={sourceNumbers} /></div><div><span className="section-index">06 / Risks</span><CitedItems items={report.comparison.risks} sourceNumbers={sourceNumbers} /></div></section>
    <section className="company-report-sources"><span className="section-index">Sources</span>{report.sources.map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>[{index + 1}]</span><div><strong>{source.title}</strong><small>{source.kind} · {source.status}{source.note ? ` · ${source.note}` : ""}</small></div><ExternalLink size={13} /></a>)}</section>
    <section className="report-method"><div><span className="section-index">Methodology</span><p>{report.methodology}</p></div><div><span className="section-index">Coverage notes</span>{report.warnings.length ? report.warnings.map((warning) => <p key={warning}>— {warning}</p>) : <p>No source coverage warnings were recorded.</p>}<p>This public-source analysis is not admissions advice, an acceptance probability, or an investment recommendation.</p></div></section>
  </main>;
}
