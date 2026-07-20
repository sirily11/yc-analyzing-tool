"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CompanyDetail } from "@/components/company-detail";
import { REPORT_MAP_COLORS, REPORT_MAP_HEIGHT, REPORT_MAP_WIDTH } from "@/lib/report-map";
import type { CompanyClusterMap } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";

type CompanyClusterPoint = CompanyClusterMap["points"][number];
type ClusterNode = { point: CompanyClusterPoint; company: YcCompany };

function nodePosition(point: CompanyClusterPoint, width: number, height: number) {
  const scale = Math.min(width / REPORT_MAP_WIDTH, height / REPORT_MAP_HEIGHT);
  const offsetX = (width - REPORT_MAP_WIDTH * scale) / 2;
  const offsetY = (height - REPORT_MAP_HEIGHT * scale) / 2;
  return {
    left: offsetX + (point.x * 700 + 30) * scale,
    top: offsetY + (point.y * 370 + 30) * scale,
  };
}

export function CompanyClusterMap({ map, companies, compact = false }: { map: CompanyClusterMap; companies: YcCompany[]; compact?: boolean }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [mapSize, setMapSize] = useState({ width: REPORT_MAP_WIDTH, height: REPORT_MAP_HEIGHT });
  const svgRef = useRef<SVGSVGElement>(null);
  const gridPatternId = `company-report-grid-${useId().replaceAll(":", "")}`;
  const lookup = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const nodes = useMemo(() => map.points.flatMap((point) => {
    const company = lookup.get(point.companyId);
    return company ? [{ point, company }] : [];
  }), [lookup, map.points]);
  const selected = selectedId === null ? null : lookup.get(selectedId) ?? null;
  const targets = nodes.filter(({ point }) => point.target);
  const activeId = hoveredId ?? selectedId;
  const activeNode = nodes.find(({ company }) => company.id === activeId) ?? null;
  const activePosition = activeNode ? nodePosition(activeNode.point, mapSize.width, mapSize.height) : null;

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
    let best: (ClusterNode & { distance: number }) | null = null;
    for (const node of nodes) {
      const position = nodePosition(node.point, rect.width, rect.height);
      const distance = Math.hypot(rect.left + position.left - clientX, rect.top + position.top - clientY);
      if (distance <= 12 && (!best || distance < best.distance)) best = { ...node, distance };
    }
    return best;
  };

  return <div className={`company-cluster-explorer ${compact ? "compact" : "report-map-grid"}`}>
    <div
      className="report-cluster company-cluster-canvas"
      onPointerMove={(event) => setHoveredId(companyAt(event.clientX, event.clientY)?.company.id ?? null)}
      onPointerLeave={() => setHoveredId(null)}
      onPointerDown={(event) => {
        const node = companyAt(event.clientX, event.clientY);
        setSelectedId(node ? selectedId === node.company.id ? null : node.company.id : null);
      }}
    >
      <svg ref={svgRef} className="report-cluster-svg" viewBox="0 0 760 430" role="img" aria-label={`Semantic cluster map of ${nodes.length} public YC companies. Hover or tap a company node for details.`}>
        <defs><pattern id={gridPatternId} width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#cec6b7" strokeWidth="1" /></pattern></defs>
        <rect width="760" height="430" fill="#f3efe5" /><rect width="760" height="430" fill={`url(#${gridPatternId})`} />
        <text x="18" y="25" className="cluster-label">REQUEST-SPECIFIC YC COMPANY SPACE</text>
        <text x="742" y="25" textAnchor="end" className="cluster-label">{map.mode === "semantic" ? "DYNAMIC SEMANTIC UMAP" : "VERSIONED MAP FALLBACK"}</text>
        {nodes.map(({ point, company }) => {
          const active = company.id === activeId;
          return <circle
            key={company.id}
            cx={point.x * 700 + 30}
            cy={point.y * 370 + 30}
            r={active ? 7 : point.target ? 4.8 : 2.4}
            fill={active ? "#25211d" : point.target ? "#d85b35" : REPORT_MAP_COLORS[company.year] ?? "#70695f"}
            opacity={active ? 1 : point.target ? .95 : .48}
            stroke={active ? "#f3efe5" : "none"}
            strokeWidth={active ? 2 : 0}
          />;
        })}
      </svg>
      <div className="report-cluster-node-layer">
        {nodes.map(({ point, company }) => {
          const position = nodePosition(point, mapSize.width, mapSize.height);
          return <button
            key={company.id}
            type="button"
            className="report-cluster-node-hit"
            style={{ left: position.left, top: position.top }}
            tabIndex={point.target ? 0 : -1}
            aria-label={`${company.name}, ${company.batch}. ${company.oneLiner}`}
            aria-pressed={selectedId === company.id}
            onFocus={() => setHoveredId(company.id)}
            onBlur={() => setHoveredId(null)}
            onClick={() => setSelectedId((current) => current === company.id ? null : company.id)}
            onKeyDown={(event) => { if (event.key === "Escape") setSelectedId(null); }}
          />;
        })}
      </div>
      <span className="report-cluster-hint">{Math.round(map.modelWeight * 100)}% model · {Math.round(map.webWeight * 100)}% web</span>
      {map.warning && <p className="company-cluster-warning">{map.warning}</p>}
      {activeNode && activePosition && <div
        className={`report-cluster-tooltip ${activeNode.point.x > .66 ? "align-left" : ""} ${activeNode.point.y > .62 ? "above" : ""}`}
        style={{ left: activePosition.left, top: activePosition.top }}
        role="status"
      >
        <strong>{activeNode.company.name} · {activeNode.company.batch}</strong>
        <span>{activeNode.company.oneLiner}</span>
        <small>{activeNode.company.industry} · {activeNode.company.location || "Location not listed"}</small>
      </div>}
    </div>
    {!compact && <aside className={`report-map-aside ${selected ? "company-detail-open" : ""}`}>
      {selected ? <CompanyDetail company={selected} onClose={() => setSelectedId(null)} /> : <>
        <div className="report-map-aside-heading"><span className="section-index">Researched companies</span><small>Click a dot or company for details</small></div>
        {targets.map(({ company }, index) => <button className="analog-row" type="button" key={company.id} onClick={() => setSelectedId(company.id)}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div><strong>{company.name}</strong><p>{company.oneLiner}</p></div>
          <b>{company.batch}</b>
        </button>)}
      </>}
    </aside>}
  </div>;
}
