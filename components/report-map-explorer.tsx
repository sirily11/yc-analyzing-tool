"use client";

import { useMemo, useState } from "react";
import { CompanyDetail } from "@/components/company-detail";
import { ReportCluster } from "@/components/report-cluster";
import type { ReportDocument } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

export function ReportMapExplorer({ report, companies }: { report: ReportDocument; companies: YcCompany[] }) {
  const [selected, setSelected] = useState<YcCompany | null>(null);
  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);

  return <div className="report-map-grid">
    <ReportCluster report={report} companies={companies} selectedCompanyId={selected?.id ?? null} onSelect={setSelected} />
    <aside className={`report-map-aside ${selected ? "company-detail-open" : ""}`}>
      {selected ? <CompanyDetail company={selected} onClose={() => setSelected(null)} /> : <>
        <div className="report-map-aside-heading"><span className="section-index">Closest analogs</span><small>Click a dot or company for details</small></div>
        {report.comparableCompanies.map((company, index) => {
          const fullCompany = companiesById.get(company.id);
          return <button className="analog-row" type="button" key={company.id} disabled={!fullCompany} onClick={() => fullCompany && setSelected(fullCompany)}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{company.name}</strong><p>{company.oneLiner}</p></div>
            <b>{Math.round(company.similarity * 100)}%</b>
          </button>;
        })}
      </>}
    </aside>
  </div>;
}
