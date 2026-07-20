"use client";

import { useId, useMemo, useState } from "react";
import { CompanyDetail } from "@/components/company-detail";
import type { CompanyClusterMap } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";

const YEAR_COLORS: Record<number, string> = { 2022: "#d55b38", 2023: "#b78b3d", 2024: "#5478a8", 2025: "#806b9f", 2026: "#315f49" };

export function CompanyClusterMap({ map, companies, compact = false }: { map: CompanyClusterMap; companies: YcCompany[]; compact?: boolean }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const gridPatternId = useId().replaceAll(":", "-");
  const lookup = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const nodes = map.points.flatMap((point) => {
    const company = lookup.get(point.companyId);
    return company ? [{ point, company }] : [];
  });
  const selected = selectedId === null ? null : lookup.get(selectedId) ?? null;
  return <div className={`company-cluster-explorer ${compact ? "compact" : ""}`}>
    <div className="company-cluster-canvas">
      <div className="company-cluster-method"><span>{map.mode === "semantic" ? "Dynamic semantic UMAP" : "Versioned map fallback"}</span><small>{Math.round(map.modelWeight * 100)}% model · {Math.round(map.webWeight * 100)}% web</small></div>
      <svg viewBox="0 0 760 430" role="img" aria-label={`Semantic cluster map of ${nodes.length} public YC companies`}>
        <defs><pattern id={gridPatternId} width="38" height="38" patternUnits="userSpaceOnUse"><path d="M 38 0 L 0 0 0 38" fill="none" stroke="#cec6b7" strokeWidth="1" /></pattern></defs>
        <rect width="760" height="430" fill="#f3efe5" /><rect width="760" height="430" fill={`url(#${gridPatternId})`} />
        {nodes.map(({ point, company }) => <circle key={company.id} cx={point.x * 700 + 30} cy={point.y * 370 + 30} r={point.target ? 7 : 3} fill={point.target ? "#d85b35" : YEAR_COLORS[company.year] ?? "#70695f"} opacity={point.target ? 1 : .58} stroke={selectedId === company.id ? "#25211d" : point.target ? "#25211d" : "none"} strokeWidth={point.target || selectedId === company.id ? 2 : 0} />)}
      </svg>
      <div className="company-cluster-hits">
        {nodes.map(({ point, company }) => <button key={company.id} type="button" style={{ left: `${point.x * 92 + 4}%`, top: `${point.y * 86 + 7}%` }} aria-label={`${company.name}, ${company.batch}. ${company.oneLiner}`} aria-pressed={selectedId === company.id} onClick={() => setSelectedId((current) => current === company.id ? null : company.id)}><span>{company.name}</span></button>)}
      </div>
      {map.warning && <p className="company-cluster-warning">{map.warning}</p>}
    </div>
    {!compact && <aside className="company-cluster-detail">{selected ? <CompanyDetail company={selected} onClose={() => setSelectedId(null)} /> : <div className="company-cluster-guide"><span className="section-index">Cluster map</span><h3>Explore the peer set</h3><p>Orange nodes are researched companies. Select any point for its public YC profile and founder details.</p><div><span><i className="target" /> Researched</span><span><i /> Context peer</span></div></div>}</aside>}
  </div>;
}
