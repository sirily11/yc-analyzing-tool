import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { ReportMapExplorer } from "@/components/report-map-explorer";
import { ReportResearchProgress } from "@/components/report-research-progress";
import { requirePageUser } from "@/lib/auth";
import { getReport } from "@/lib/db/repository";
import { reportResearchProgress } from "@/lib/research/report-research";
import { createPageMetadata } from "@/lib/site-metadata";
import type { ComparableResearchSource } from "@/lib/types/analysis";
import { loadYcCompanies } from "@/lib/yc/companies";

export const dynamic = "force-dynamic";

type ReportPageProps = { params: Promise<{ reportId: string }> };

function ResearchCitations({ ids, sources }: { ids: string[]; sources: Map<string, ComparableResearchSource> }) {
  return <span className="research-citations">{ids.flatMap((id) => {
    const source = sources.get(id);
    return source ? [<a href={source.url} target="_blank" rel="noopener noreferrer" key={id}>[{id}]</a>] : [];
  })}</span>;
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { reportId } = await params;
  return createPageMetadata("report", `/reports/${encodeURIComponent(reportId)}`, { privatePage: true });
}

export default async function ReportPage({ params }: ReportPageProps) {
  const user = await requirePageUser(); const { reportId } = await params;
  const reportRow = await getReport(user.id, reportId);
  if (!reportRow) notFound();
  if (reportRow.status !== "complete" || !reportRow.document) {
    const progress = await reportResearchProgress(user.id, reportId);
    if (!progress) notFound();
    return <ReportResearchProgress reportId={reportId} companyName={reportRow.profile?.companyName ?? reportRow.sourceFile.name.replace(/\.pdf$/i, "")} initialProgress={{ status: progress.status, jobs: progress.jobs }} />;
  }
  const report = reportRow.document;
  const dossier = report.schemaVersion === 2 ? report.dossier : undefined;
  const researchSources = new Map((dossier?.researchSources ?? []).map((source) => [source.id, source]));
  const founder = report.profile.founderProfile;
  const scoreComponents = report.prediction.scoreComponents;
  const companies = await loadYcCompanies();
  return (
    <main className="report-page">
      <header className="report-topbar"><Link href="/dashboard"><ArrowLeft size={15} /> Back to reports</Link><span className="brand"><span className="brand-mark">A</span> APPLICATION SIGNAL</span><a className="button-dark" href={`/api/reports/${reportId}/pdf`}><Download size={15} /> Download PDF</a></header>
      <section className="report-hero"><div><p className="eyebrow">Private application report · {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(reportRow.createdAt)}</p><h1>{report.profile.companyName}</h1><p>{report.executiveSummary}</p><span className="privacy-pill"><ShieldCheck size={13} /> {reportRow.sourceFile.kind === "chat" ? "Conversation source" : "Source PDF retained in S3"}</span></div><div className="score-panel"><span>YC Fit Score</span><strong>{Math.round(report.prediction.score)}</strong><small>/100 · {report.prediction.band}</small><p>Evidence coverage: {report.prediction.coverage}</p>{scoreComponents && <p>Startup {Math.round(scoreComponents.startupFit)}/100 · Founder {scoreComponents.founderFit === null ? "not evidenced" : `${Math.round(scoreComponents.founderFit)}/100`}</p>}</div></section>
      {dossier && <section className="report-evidence-section"><div className="report-section-heading"><span className="section-index">02 / Evidence</span><h2>What the approved source actually establishes.</h2><p>Claims stay linked to their PDF page or to the approved conversation brief. Missing evidence is labeled instead of inferred.</p></div><div className="candidate-evidence-grid">{dossier.candidateEvidence.map((item, index) => <article key={`${item.claim}-${index}`}><span>{item.page ? `P.${item.page}` : item.sourceLabel}</span><p>{item.claim}</p></article>)}</div></section>}
      <section className="report-map-section"><div className="report-section-heading"><span className="section-index">{dossier ? "03" : "01"} / Position</span><h2>Your company in the YC map</h2><p>The highlighted candidate is placed at the weighted center of its 12 nearest public-company profiles. Compare its current cluster with the live YC directory, then choose one or more YC years.</p></div><ReportMapExplorer reportId={reportId} report={report} companies={companies} /></section>
      <section className="report-insight-grid"><div><span className="section-index">{dossier ? "04 / Diagnosis" : "02 / Application profile"}</span><h2>{report.profile.sector}</h2><p>{report.profile.summary}</p><dl><div><dt>Target customer</dt><dd>{report.profile.targetCustomer}</dd></div><div><dt>Business model</dt><dd>{report.profile.businessModel}</dd></div><div><dt>Product</dt><dd>{report.profile.productModality}</dd></div><div><dt>Stage</dt><dd>{report.profile.stage}</dd></div>{founder && <><div><dt>Founder capabilities</dt><dd>{founder.capabilityDomains.length ? founder.capabilityDomains.join(", ") : "Not evidenced"}</dd></div><div><dt>Founder experience</dt><dd>{founder.domainExperience} domain · {founder.technicalCapability} technical</dd></div><div><dt>Team complementarity</dt><dd>{founder.teamComplementarity}</dd></div></>}</dl>{dossier && <div className="diagnosis-list"><article><h3>Market & customer</h3><p>{dossier.diagnosis.marketCustomer}</p></article><article><h3>Product</h3><p>{dossier.diagnosis.product}</p></article><article><h3>Traction</h3><p>{dossier.diagnosis.traction}</p></article><article><h3>Founder advantage</h3><p>{dossier.diagnosis.founders}</p></article><article><h3>Readiness</h3><p>{dossier.diagnosis.readiness}</p></article></div>}</div><div className="factor-panel"><span className="section-index">Model factors</span>{report.prediction.factors.map((factor) => <div key={factor.label}><span>{factor.label}</span><strong>{factor.value}</strong><i className={factor.impact} /></div>)}{dossier && <p>{dossier.scoreInterpretation}</p>}<p>Score kind: <strong>accepted-company fit</strong>, not acceptance probability.</p></div></section>
      {dossier && <section className="comparison-section"><div className="report-section-heading"><span className="section-index">05 / Comparison</span><h2>Five public companies, compared on the facts.</h2><p>The model selected the neighbors. Public research explains their execution patterns but never changes the score.</p></div><div className="comparison-table-wrap"><table><thead><tr><th>Company</th><th>Product</th><th>Customer</th><th>Business model</th><th>Traction</th><th>Founders</th><th>Similarity</th><th>Useful difference</th><th>Lesson</th></tr></thead><tbody>{dossier.comparisonMatrix.map((row) => <tr key={row.companyId}><th>{row.companyName}<ResearchCitations ids={row.sourceIds} sources={researchSources} /></th><td>{row.product}</td><td>{row.customer}</td><td>{row.businessModel}</td><td>{row.traction}</td><td>{row.founders}</td><td>{row.similarity}</td><td>{row.difference}</td><td>{row.lesson}</td></tr>)}</tbody></table></div></section>}
      {dossier && <section className="deep-dives"><div className="report-section-heading"><span className="section-index">06 / Deep dives</span><h2>Website, founder, and traction signals.</h2><p>Only public professional evidence is used. Unknowns remain unknown.</p></div>{dossier.companyDeepDives.map((company, index) => <article key={company.companyId}><header><span>{String(index + 1).padStart(2, "0")}</span><h3>{company.companyName}</h3><ResearchCitations ids={company.sourceIds} sources={researchSources} /></header><p>{company.overview}</p><div><section><h4>Website</h4><p>{company.websiteAnalysis}</p></section><section><h4>Founders</h4><p>{company.founderAnalysis}</p></section><section><h4>Traction</h4><p>{company.tractionAnalysis}</p></section></div><dl><div><dt>Similarities</dt><dd>{company.similarities.join(" ")}</dd></div><div><dt>Differences</dt><dd>{company.differences.join(" ")}</dd></div><div><dt>Lessons</dt><dd>{company.lessons.join(" ")}</dd></div></dl></article>)}</section>}
      <section className="report-two-column"><div><span className="section-index">{dossier ? "07 / Strengths" : "03 / Strengths"}</span><h2>Signals to keep</h2>{report.strengths.map((item, index) => <article key={`${item}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></article>)}</div><div><span className="section-index">{dossier ? "07 / Risks" : "04 / Gaps"}</span><h2>Evidence to sharpen</h2>{dossier ? dossier.risks.map((risk, index) => <article key={`${risk.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p><strong>{risk.title}</strong><br />{risk.detail}<small>Proof to add: {risk.evidenceToAdd}</small></p></article>) : report.gaps.map((item, index) => <article key={`${item}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></article>)}</div></section>
      <section className="recommendations"><div className="report-section-heading"><span className="section-index">{dossier ? "08" : "05"} / Improvement plan</span><h2>Make the next draft more decision-dense.</h2></div>{dossier ? dossier.recommendations.map((item) => <article key={item.priority}><span>{String(item.priority).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.action}</p><dl><div><dt>Why</dt><dd>{item.rationale}</dd></div><div><dt>Proof to add</dt><dd>{item.proofToAdd}</dd></div><div><dt>Suggested framing</dt><dd>{item.suggestedFraming}</dd></div></dl></div></article>) : report.recommendations.map((item) => <article key={item.priority}><span>{String(item.priority).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.detail}</p></div></article>)}</section>
      {dossier && <section className="action-plan"><div className="report-section-heading"><span className="section-index">09 / 30 days</span><h2>Turn the report into stronger evidence.</h2><p>A sequenced plan for validation, rewriting, and stress-testing.</p></div><div>{dossier.actionPlan.map((item) => <article key={item.period}><span>{item.period}</span><h3>{item.focus}</h3><ol>{item.actions.map((action) => <li key={action}>{action}</li>)}</ol></article>)}</div></section>}
      {dossier && <section className="source-appendix"><div className="report-section-heading"><span className="section-index">10 / Sources</span><h2>Detailed research index.</h2><p>Each externally researched claim points to this time-stamped source index.</p></div>{dossier.researchWarnings.map((warning) => <p className="research-warning" key={warning}>— {warning}</p>)}<div>{dossier.researchSources.map((source) => <article key={source.id}><span>{source.id}</span><div><strong>{source.title}</strong><small>{source.sourceType.replaceAll("-", " ")} · Accessed {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(source.accessedAt))}</small><a href={source.url} target="_blank" rel="noopener noreferrer">{source.url} <ExternalLink size={11} /></a></div></article>)}</div></section>}
      <section className="report-method"><div><span className="section-index">Methodology</span><p>{report.methodology}</p></div><div><span className="section-index">Limitations</span><p>{report.disclaimer}</p>{report.prediction.warnings.map((warning) => <p key={warning}>— {warning}</p>)}</div></section>
      <footer className="report-footer"><span>Dataset {report.prediction.datasetVersion} · Fit model {report.prediction.modelVersion}{report.generation ? ` · Draft model ${report.generation.draftModel}` : ""}</span><a href="https://github.com/yc-oss/api" target="_blank" rel="noreferrer">Public data source <ExternalLink size={12} /></a></footer>
    </main>
  );
}
