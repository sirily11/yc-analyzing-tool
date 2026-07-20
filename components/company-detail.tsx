"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import type { YcCompany, YcCompanyDetail } from "@/lib/types/company";

type ReportGenerationStage = "idle" | "confirm" | "researching";

export function CompanyDetail({ company, onClose, reportSourceId }: { company: YcCompany; onClose: () => void; reportSourceId?: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<YcCompanyDetail | null>(null);
  const [error, setError] = useState(false);
  const [reportStage, setReportStage] = useState<ReportGenerationStage>("idle");
  const [reportError, setReportError] = useState<string | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(false);
    fetch(`/api/companies/${encodeURIComponent(company.slug)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Company detail request failed: ${response.status}`);
        return response.json() as Promise<YcCompanyDetail>;
      })
      .then(setDetail)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(true);
      });
    return () => controller.abort();
  }, [company.slug]);

  useEffect(() => {
    generationAbortRef.current?.abort();
    setReportStage("idle");
    setReportError(null);
    return () => generationAbortRef.current?.abort();
  }, [company.id]);

  async function generateReport() {
    if (!reportSourceId || reportStage !== "confirm") return;
    const controller = new AbortController();
    generationAbortRef.current = controller;
    setReportError(null);
    setReportStage("researching");
    try {
      const researchResponse = await fetch("/api/company-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceReportId: reportSourceId, companyId: company.id }),
        signal: controller.signal,
      });
      const research = await researchResponse.json().catch(() => null) as { reportId?: string; href?: string; error?: string } | null;
      if (!researchResponse.ok || !research?.reportId || !research.href) {
        throw new Error(research?.error ?? "Company research could not start.");
      }
      generationAbortRef.current = null;
      router.push(research.href);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setReportError(cause instanceof Error ? cause.message : "Company report generation failed.");
      setReportStage("confirm");
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
    }
  }

  const generating = reportStage === "researching";

  const website = company.website && /^https?:\/\//i.test(company.website) ? company.website : null;
  const ycUrl = `https://www.ycombinator.com/companies/${encodeURIComponent(company.slug)}`;

  return <div className="company-detail" aria-live="polite">
    <div className="panel-heading"><span className="section-index">03 / Company</span><button className="text-action" type="button" onClick={onClose} disabled={generating}>Close</button></div>
    <div className="company-detail-heading">
      <span className="company-detail-logo">{company.logo ? <img src={company.logo} alt="" /> : company.name.slice(0, 1)}</span>
      <div><p className="eyebrow">{company.batch}</p><h2>{company.name}</h2></div>
    </div>
    <p className="company-detail-oneliner">{company.oneLiner}</p>
    <div className="company-detail-badges">
      <span>{detail?.status ?? "Public YC company"}</span>
      {company.hiring && <span className="hiring">Hiring</span>}
      {company.aiLinked && <span>AI-linked</span>}
    </div>
    <dl className="company-facts">
      <div><dt>Location</dt><dd>{company.location}</dd></div>
      <div><dt>Industry</dt><dd>{company.subindustry}</dd></div>
      <div><dt>Target market</dt><dd>{company.targetMarket}</dd></div>
      <div><dt>Founded</dt><dd>{detail?.yearFounded ?? "—"}</dd></div>
      <div><dt>Team size</dt><dd>{detail?.teamSize?.toLocaleString() ?? "—"}</dd></div>
    </dl>
    {detail?.longDescription && <section className="company-description"><h3>About</h3><p>{detail.longDescription}</p></section>}
    <section className="founder-section">
      <h3>Founders</h3>
      {!detail && !error && <div className="detail-loading"><span /><span /><span /></div>}
      {error && <p className="detail-state">Founder details could not be loaded. <a href={ycUrl} target="_blank" rel="noreferrer">View the YC profile ↗</a></p>}
      {detail && detail.founders.length === 0 && <p className="detail-state">No public founder profiles are listed for this company.</p>}
      {detail?.founders.map((founder) => <article className="founder-card" key={`${founder.id}-${founder.name}`}>
        <span className="founder-initial">{founder.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
        <div>
          <strong>{founder.name}</strong><small>{founder.title}</small>
          {founder.bio && <p>{founder.bio}</p>}
          {(founder.linkedIn || founder.twitter) && <div className="founder-links">
            {founder.linkedIn && <a href={founder.linkedIn} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
            {founder.twitter && <a href={founder.twitter} target="_blank" rel="noreferrer">X ↗</a>}
          </div>}
        </div>
      </article>)}
    </section>
    {detail?.tags.length ? <div className="company-tags">{detail.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
    <div className="company-detail-actions">
      {reportSourceId && <button className="button-dark company-report-trigger" type="button" onClick={() => { setReportError(null); setReportStage("confirm"); }}><Sparkles size={13} /> Generate company report</button>}
      {website && <a className="button-dark" href={website} target="_blank" rel="noreferrer">Visit website ↗</a>}
      <a className="button-ghost" href={ycUrl} target="_blank" rel="noreferrer">YC profile ↗</a>
    </div>
    {reportStage !== "idle" && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !generating) setReportStage("idle"); }}>
      <section className="chat-dialog company-report-dialog" role="dialog" aria-modal="true" aria-labelledby="company-report-dialog-title" onKeyDown={(event) => { if (event.key === "Escape" && !generating) setReportStage("idle"); }}>
        <button className="dialog-close" type="button" aria-label="Close company report dialog" onClick={() => setReportStage("idle")} disabled={generating}><X size={15} /></button>
        <span className="section-index">Public company research</span>
        <h2 id="company-report-dialog-title">Generate a report on {company.name}?</h2>
        <p>This starts durable Firecrawl research in Vercel Workflow, then opens a private progress page that builds the semantic map in your browser when the research is ready.</p>
        {generating && <div className="company-report-generation-status" role="status"><LoaderCircle className="spin" size={17} /><div><strong>Starting durable public-company research…</strong></div></div>}
        {reportError && <p className="dialog-error" role="alert">{reportError}</p>}
        {!generating && <div className="dialog-actions"><button className="button-ghost" type="button" onClick={() => setReportStage("idle")}>Cancel</button><button className="button-dark" type="button" onClick={() => void generateReport()}>Generate report</button></div>}
      </section>
    </div>}
  </div>;
}
