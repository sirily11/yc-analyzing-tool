"use client";

import { useMemo, useState } from "react";
import { CompanyDetail } from "@/components/company-detail";
import { ReportCluster } from "@/components/report-cluster";
import { ReportMapControls } from "@/components/report-map-controls";
import { filterReportMapCompanies, reportMapYears, selectReportMapCompanies, type ReportMapScope } from "@/lib/report-map";
import type { ReportDocument } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

export function ReportMapExplorer({ reportId, report, companies }: { reportId: string; report: ReportDocument; companies: YcCompany[] }) {
  const [selected, setSelected] = useState<YcCompany | null>(null);
  const [scope, setScope] = useState<ReportMapScope>("cluster");
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const years = useMemo(() => reportMapYears(companies), [companies]);
  const clusterCompanies = useMemo(
    () => selectReportMapCompanies(companies, report.prediction.clusterPoint).map(({ company }) => company),
    [companies, report.prediction.clusterPoint.x, report.prediction.clusterPoint.y],
  );
  const scopedCompanies = scope === "all" ? companies : clusterCompanies;
  const visibleCompanies = useMemo(
    () => filterReportMapCompanies(scopedCompanies, selectedYears),
    [scopedCompanies, selectedYears],
  );

  return <div className="report-map-explorer">
    <ReportMapControls
      scope={scope}
      onScopeChange={setScope}
      years={years}
      selectedYears={selectedYears}
      onSelectedYearsChange={setSelectedYears}
      visibleCount={visibleCompanies.length}
      scopeCount={scopedCompanies.length}
    />
    <div className="report-map-grid">
      <ReportCluster report={report} companies={visibleCompanies} scope={scope} selectedCompanyId={selected?.id ?? null} onSelect={setSelected} />
      <aside className={`report-map-aside ${selected ? "company-detail-open" : ""}`}>
        {selected ? <CompanyDetail company={selected} reportSourceId={reportId} onClose={() => setSelected(null)} /> : <>
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
    </div>
  </div>;
}
