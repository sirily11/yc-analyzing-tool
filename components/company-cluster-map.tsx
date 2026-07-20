"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CompanyDetail } from "@/components/company-detail";
import { ReportMapControls } from "@/components/report-map-controls";
import { ReportMapPointCanvas, type ReportMapCanvasPoint } from "@/components/report-map-point-canvas";
import {
  companyReportMapNodes,
  projectReportMapPoint,
  reportMapColor,
  reportMapYears,
  REPORT_MAP_HEIGHT,
  REPORT_MAP_WIDTH,
  type CompanyReportMapNode,
  type ReportMapScope,
} from "@/lib/report-map";
import type { CompanyClusterMap } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";

type MapProjection = "request" | "global";

function projectedPoint(point: CompanyReportMapNode["point"], projection: MapProjection) {
  return projection === "global"
    ? projectReportMapPoint(point)
    : { x: point.x * 700 + 30, y: point.y * 370 + 30 };
}

function nodePosition(point: CompanyReportMapNode["point"], projection: MapProjection, width: number, height: number) {
  const scale = Math.min(width / REPORT_MAP_WIDTH, height / REPORT_MAP_HEIGHT);
  const offsetX = (width - REPORT_MAP_WIDTH * scale) / 2;
  const offsetY = (height - REPORT_MAP_HEIGHT * scale) / 2;
  const projected = projectedPoint(point, projection);
  return { left: offsetX + projected.x * scale, top: offsetY + projected.y * scale };
}

export function CompanyClusterMap({ map, companies, compact = false }: { map: CompanyClusterMap; companies: YcCompany[]; compact?: boolean }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [scope, setScope] = useState<ReportMapScope>("cluster");
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [mapSize, setMapSize] = useState({ width: REPORT_MAP_WIDTH, height: REPORT_MAP_HEIGHT });
  const svgRef = useRef<SVGSVGElement>(null);
  const gridPatternId = `company-report-grid-${useId().replaceAll(":", "")}`;
  const lookup = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const years = useMemo(() => reportMapYears(companies), [companies]);
  const projection: MapProjection = scope === "all" || map.mode === "fallback-global" ? "global" : "request";
  const nodes = useMemo(
    () => companyReportMapNodes(map, companies, compact ? "cluster" : scope, compact ? [] : selectedYears),
    [companies, compact, map, scope, selectedYears],
  );
  const scopeNodes = useMemo(
    () => companyReportMapNodes(map, companies, compact ? "cluster" : scope, []),
    [companies, compact, map, scope],
  );
  const targets = useMemo(() => map.points.flatMap((point) => {
    if (!point.target) return [];
    const company = lookup.get(point.companyId);
    return company ? [{ point, company }] : [];
  }), [lookup, map.points]);
  const selected = selectedId === null ? null : lookup.get(selectedId) ?? null;
  const activeId = hoveredId ?? selectedId;
  const activeNode = nodes.find(({ company }) => company.id === activeId) ?? null;
  const activePosition = activeNode ? nodePosition(activeNode.point, projection, mapSize.width, mapSize.height) : null;
  const referenceCount = nodes.filter(({ point }) => !point.target).length;
  const canvasPoints = useMemo<ReportMapCanvasPoint[]>(() => nodes.map(({ point, company }) => ({
    id: company.id,
    ...projectedPoint(point, projection),
    radius: point.target ? 4.8 : scope === "all" ? 1.8 : 2.4,
    fill: point.target ? "#d85b35" : reportMapColor(company.year),
    opacity: point.target ? .95 : scope === "all" ? .4 : .48,
    stroke: point.target ? "#25211d" : undefined,
    strokeWidth: point.target ? 1.2 : undefined,
  })), [nodes, projection, scope]);

  useEffect(() => {
    setHoveredId(null);
    setSelectedId((current) => current !== null && nodes.some(({ company }) => company.id === current) ? current : null);
  }, [nodes]);

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
    let best: (CompanyReportMapNode & { distance: number }) | null = null;
    for (const node of nodes) {
      const position = nodePosition(node.point, projection, rect.width, rect.height);
      const distance = Math.hypot(rect.left + position.left - clientX, rect.top + position.top - clientY);
      if (distance <= 12 && (!best || distance < best.distance)) best = { ...node, distance };
    }
    return best;
  };

  const clusterLabel = scope === "all"
    ? "ALL YC COMPANY SPACE"
    : map.mode === "semantic" ? "REQUEST-SPECIFIC YC COMPANY SPACE" : "CURRENT GLOBAL SUBSET";
  const layoutLabel = scope === "all"
    ? "LIVE GLOBAL DIRECTORY"
    : map.mode === "semantic" ? "DYNAMIC SEMANTIC UMAP" : "VERSIONED MAP FALLBACK";

  return <div className={`company-cluster-explorer ${compact ? "compact" : ""}`}>
    {!compact && <ReportMapControls
      scope={scope}
      onScopeChange={setScope}
      years={years}
      selectedYears={selectedYears}
      onSelectedYearsChange={setSelectedYears}
      visibleCount={nodes.length}
      scopeCount={scopeNodes.length}
      pinnedNote={scope === "all" ? "Report companies stay visible · live global layout" : map.mode === "semantic" ? "Report companies stay visible · request-specific layout" : "Report companies stay visible · global fallback layout"}
    />}
    <div className={compact ? "company-cluster-compact-layout" : "report-map-grid"}>
      <div
        className="report-cluster company-cluster-canvas"
        onPointerMove={(event) => setHoveredId(companyAt(event.clientX, event.clientY)?.company.id ?? null)}
        onPointerLeave={() => setHoveredId(null)}
        onPointerDown={(event) => {
          const node = companyAt(event.clientX, event.clientY);
          setSelectedId(node ? selectedId === node.company.id ? null : node.company.id : null);
        }}
      >
        <svg ref={svgRef} className="report-cluster-svg report-cluster-background" viewBox="0 0 760 430" role="img" aria-label={`${scope === "all" ? "Live global layout" : "Semantic cluster"} of ${nodes.length} public YC companies. Hover or tap a company node for details.`}>
          <defs><pattern id={gridPatternId} width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#cec6b7" strokeWidth="1" /></pattern></defs>
          <rect width="760" height="430" fill="#f3efe5" /><rect width="760" height="430" fill={`url(#${gridPatternId})`} />
          <text x="18" y="25" className="cluster-label">{clusterLabel}</text>
          <text x="742" y="25" textAnchor="end" className="cluster-label">{layoutLabel}</text>
        </svg>
        <ReportMapPointCanvas points={canvasPoints} activeId={activeId} />
        <div className="report-cluster-node-layer">
          {nodes.filter(({ point }) => point.target).map(({ point, company }) => {
            const position = nodePosition(point, projection, mapSize.width, mapSize.height);
            return <button
              key={company.id}
              type="button"
              className="report-cluster-node-hit"
              style={{ left: position.left, top: position.top }}
              aria-label={`${company.name}, ${company.batch}. ${company.oneLiner}`}
              aria-pressed={selectedId === company.id}
              onFocus={() => setHoveredId(company.id)}
              onBlur={() => setHoveredId(null)}
              onClick={() => setSelectedId((current) => current === company.id ? null : company.id)}
              onKeyDown={(event) => { if (event.key === "Escape") setSelectedId(null); }}
            />;
          })}
        </div>
        <span className="report-cluster-hint">{scope === "all" ? "Live global layout" : map.mode === "semantic" ? `${Math.round(map.modelWeight * 100)}% model · ${Math.round(map.webWeight * 100)}% web` : "Versioned global fallback"}</span>
        {map.warning && scope === "cluster" && <p className="company-cluster-warning">{map.warning}</p>}
        {referenceCount === 0 && <p className="report-map-empty">No comparison companies match the selected years.</p>}
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
    </div>
  </div>;
}
