"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ReportMapPointCanvas, type ReportMapCanvasPoint } from "@/components/report-map-point-canvas";
import { projectReportMapPoint, reportMapColor, REPORT_MAP_HEIGHT, REPORT_MAP_WIDTH, type ReportMapScope } from "@/lib/report-map";
import type { ReportDocument } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

function nodePosition(company: YcCompany, width: number, height: number) {
  const scale = Math.min(width / REPORT_MAP_WIDTH, height / REPORT_MAP_HEIGHT);
  const offsetX = (width - REPORT_MAP_WIDTH * scale) / 2;
  const offsetY = (height - REPORT_MAP_HEIGHT * scale) / 2;
  const point = projectReportMapPoint(company);
  return { left: offsetX + point.x * scale, top: offsetY + point.y * scale };
}

export function ReportCluster({ report, companies, scope, selectedCompanyId, onSelect }: { report: ReportDocument; companies: YcCompany[]; scope: ReportMapScope; selectedCompanyId: number | null; onSelect: (company: YcCompany | null) => void }) {
  const center = report.prediction.clusterPoint;
  const nearest = useMemo(() => new Set(report.prediction.nearestCompanyIds), [report.prediction.nearestCompanyIds]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [mapSize, setMapSize] = useState({ width: 760, height: 430 });
  const svgRef = useRef<SVGSVGElement>(null);
  const activeId = hoveredId ?? selectedCompanyId;
  const activeCompany = companies.find((company) => company.id === activeId) ?? null;
  const activePosition = activeCompany ? nodePosition(activeCompany, mapSize.width, mapSize.height) : null;
  const canvasPoints = useMemo<ReportMapCanvasPoint[]>(() => companies.map((company) => {
    const point = projectReportMapPoint(company);
    const isNearest = nearest.has(company.id);
    return {
      id: company.id,
      ...point,
      radius: isNearest ? 4.8 : scope === "all" ? 1.8 : 2.4,
      fill: reportMapColor(company.year),
      opacity: isNearest ? .95 : scope === "all" ? .4 : .48,
    };
  }), [companies, nearest, scope]);
  const keyboardCompanies = useMemo(() => companies.filter((company) => nearest.has(company.id)), [companies, nearest]);
  const id = useId().replaceAll(":", "");
  const gridId = `report-grid-${id}`;
  const glowId = `candidate-glow-${id}`;
  useEffect(() => setHoveredId(null), [companies]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const updateSize = () => {
      const rect = svg.getBoundingClientRect();
      setMapSize((current) => current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const companyAt = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    let best: { company: YcCompany; distance: number } | null = null;
    for (const company of companies) {
      const position = nodePosition(company, rect.width, rect.height);
      const distance = Math.hypot(rect.left + position.left - clientX, rect.top + position.top - clientY);
      if (distance <= 12 && (!best || distance < best.distance)) best = { company, distance };
    }
    return best?.company ?? null;
  };

  return (
    <div
      className="report-cluster"
      onPointerMove={(event) => setHoveredId(companyAt(event.clientX, event.clientY)?.id ?? null)}
      onPointerLeave={() => setHoveredId(null)}
      onPointerDown={(event) => {
        const company = companyAt(event.clientX, event.clientY);
        onSelect(company ? selectedCompanyId === company.id ? null : company : null);
      }}
    >
      <svg ref={svgRef} className="report-cluster-svg report-cluster-background" viewBox="0 0 760 430" role="img" aria-label={`${report.profile.companyName} positioned among ${scope === "all" ? "the live YC directory" : "its current YC comparison cluster"}. Hover or tap a company node for details.`}>
        <defs><pattern id={gridId} width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#cec6b7" strokeWidth="1" /></pattern></defs>
        <rect width="760" height="430" fill="#f3efe5" /><rect width="760" height="430" fill={`url(#${gridId})`} />
        <text x="18" y="25" className="cluster-label">{scope === "all" ? "ALL YC COMPANY SPACE" : "CURRENT COMPARISON CLUSTER"}</text><text x="742" y="25" textAnchor="end" className="cluster-label">{scope === "all" ? "LIVE GLOBAL DIRECTORY" : report.profile.sector.toUpperCase()}</text>
      </svg>
      <ReportMapPointCanvas points={canvasPoints} activeId={activeId} />
      <svg className="report-cluster-overlay" viewBox="0 0 760 430" aria-hidden="true">
        <defs><filter id={glowId}><feGaussianBlur stdDeviation="6" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        {(() => {
          const point = projectReportMapPoint(center);
          return <>
            <circle cx={point.x} cy={point.y} r="15" fill="#d85b35" opacity=".2" filter={`url(#${glowId})`} />
            <circle cx={point.x} cy={point.y} r="7" fill="#d85b35" stroke="#25211d" strokeWidth="2" />
            <line x1={point.x} y1={point.y - 10} x2={Math.min(620, point.x + 35)} y2={Math.max(58, point.y - 40)} stroke="#25211d" strokeWidth="1" />
            <text x={Math.min(625, point.x + 40)} y={Math.max(55, point.y - 43)} className="candidate-label">{report.profile.companyName.toUpperCase()}</text>
          </>;
        })()}
      </svg>
      <div className="report-cluster-node-layer">
        {keyboardCompanies.map((company) => {
          const position = nodePosition(company, mapSize.width, mapSize.height);
          return <button
            key={company.id}
            type="button"
            className="report-cluster-node-hit"
            style={{ left: position.left, top: position.top }}
            tabIndex={nearest.has(company.id) ? 0 : -1}
            aria-label={`${company.name}, ${company.batch}. ${company.oneLiner}`}
            aria-pressed={selectedCompanyId === company.id}
            onFocus={() => setHoveredId(company.id)}
            onBlur={() => setHoveredId(null)}
            onClick={() => onSelect(selectedCompanyId === company.id ? null : company)}
            onKeyDown={(event) => { if (event.key === "Escape") onSelect(null); }}
          />;
        })}
      </div>
      <span className="report-cluster-hint">{scope === "all" ? "Live global layout" : "Nearest-company layout"} · Hover or tap</span>
      {companies.length === 0 && <p className="report-map-empty">No YC companies match the selected years.</p>}
      {activeCompany && activePosition && <div
          className={`report-cluster-tooltip ${activeCompany.x > .66 ? "align-left" : ""} ${activeCompany.y > .62 ? "above" : ""}`}
          style={{ left: activePosition.left, top: activePosition.top }}
          role="status"
        >
          <strong>{activeCompany.name} · {activeCompany.batch}</strong>
          <span>{activeCompany.oneLiner}</span>
          <small>{activeCompany.industry} · {activeCompany.location || "Location not listed"}</small>
        </div>}
    </div>
  );
}
