import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { ReportMapExplorer } from "@/components/report-map-explorer";
import { requirePageUser } from "@/lib/auth";
import { getReport } from "@/lib/db/repository";
import type { YcCompany } from "@/lib/types/company";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const user = await requirePageUser(); const { reportId } = await params;
  const reportRow = await getReport(user.id, reportId);
  if (!reportRow || reportRow.status !== "complete" || !reportRow.document) notFound();
  const report = reportRow.document;
  const companies = JSON.parse(await readFile(path.join(process.cwd(), "public/data/yc-companies.json"), "utf8")) as YcCompany[];
  return (
    <main className="report-page">
      <header className="report-topbar"><Link href="/dashboard"><ArrowLeft size={15} /> Back to reports</Link><span className="brand"><span className="brand-mark">A</span> APPLICATION SIGNAL</span><a className="button-dark" href={`/api/reports/${reportId}/pdf`}><Download size={15} /> Download PDF</a></header>
      <section className="report-hero"><div><p className="eyebrow">Private application report · {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(reportRow.createdAt)}</p><h1>{report.profile.companyName}</h1><p>{report.executiveSummary}</p><span className="privacy-pill"><ShieldCheck size={13} /> {reportRow.sourceFile.kind === "chat" ? "Conversation source" : "Source PDF retained in S3"}</span></div><div className="score-panel"><span>YC Fit Score</span><strong>{Math.round(report.prediction.score)}</strong><small>/100 · {report.prediction.band}</small><p>Evidence coverage: {report.prediction.coverage}</p></div></section>
      <section className="report-map-section"><div className="report-section-heading"><span className="section-index">01 / Position</span><h2>Your company in the recent YC map</h2><p>The highlighted candidate is placed at the weighted center of its 12 nearest public-company profiles. Click any dot to inspect the company.</p></div><ReportMapExplorer report={report} companies={companies} /></section>
      <section className="report-insight-grid"><div><span className="section-index">02 / Application profile</span><h2>{report.profile.sector}</h2><p>{report.profile.summary}</p><dl><div><dt>Target customer</dt><dd>{report.profile.targetCustomer}</dd></div><div><dt>Business model</dt><dd>{report.profile.businessModel}</dd></div><div><dt>Product</dt><dd>{report.profile.productModality}</dd></div><div><dt>Stage</dt><dd>{report.profile.stage}</dd></div></dl></div><div className="factor-panel"><span className="section-index">Model factors</span>{report.prediction.factors.map((factor) => <div key={factor.label}><span>{factor.label}</span><strong>{factor.value}</strong><i className={factor.impact} /></div>)}<p>Score kind: <strong>accepted-company fit</strong>, not acceptance probability.</p></div></section>
      <section className="report-two-column"><div><span className="section-index">03 / Strengths</span><h2>Signals to keep</h2>{report.strengths.map((item, index) => <article key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></article>)}</div><div><span className="section-index">04 / Gaps</span><h2>Evidence to sharpen</h2>{report.gaps.map((item, index) => <article key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></article>)}</div></section>
      <section className="recommendations"><div className="report-section-heading"><span className="section-index">05 / Improvement plan</span><h2>Make the next draft more decision-dense.</h2></div>{report.recommendations.map((item) => <article key={item.priority}><span>{String(item.priority).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.detail}</p></div></article>)}</section>
      <section className="report-method"><div><span className="section-index">Methodology</span><p>{report.methodology}</p></div><div><span className="section-index">Limitations</span><p>{report.disclaimer}</p>{report.prediction.warnings.map((warning) => <p key={warning}>— {warning}</p>)}</div></section>
      <footer className="report-footer"><span>Dataset {report.prediction.datasetVersion} · Model {report.prediction.modelVersion}</span><a href="https://github.com/yc-oss/api" target="_blank" rel="noreferrer">Public data source <ExternalLink size={12} /></a></footer>
    </main>
  );
}
