"use client";

import { useEffect, useState } from "react";
import type { YcCompany, YcCompanyDetail } from "@/lib/types/company";

export function CompanyDetail({ company, onClose }: { company: YcCompany; onClose: () => void }) {
  const [detail, setDetail] = useState<YcCompanyDetail | null>(null);
  const [error, setError] = useState(false);

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

  const website = company.website && /^https?:\/\//i.test(company.website) ? company.website : null;
  const ycUrl = `https://www.ycombinator.com/companies/${encodeURIComponent(company.slug)}`;

  return <div className="company-detail" aria-live="polite">
    <div className="panel-heading"><span className="section-index">03 / Company</span><button className="text-action" type="button" onClick={onClose}>Close</button></div>
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
      {website && <a className="button-dark" href={website} target="_blank" rel="noreferrer">Visit website ↗</a>}
      <a className="button-ghost" href={ycUrl} target="_blank" rel="noreferrer">YC profile ↗</a>
    </div>
  </div>;
}
