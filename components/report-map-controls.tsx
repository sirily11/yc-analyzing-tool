"use client";

import { useId, type CSSProperties } from "react";
import { reportMapColor, toggleReportMapYear, type ReportMapScope } from "@/lib/report-map";

type ReportMapControlsProps = {
  scope: ReportMapScope;
  onScopeChange: (scope: ReportMapScope) => void;
  years: number[];
  selectedYears: number[];
  onSelectedYearsChange: (years: number[]) => void;
  visibleCount: number;
  scopeCount: number;
  pinnedNote?: string;
};

export function ReportMapControls({
  scope,
  onScopeChange,
  years,
  selectedYears,
  onSelectedYearsChange,
  visibleCount,
  scopeCount,
  pinnedNote,
}: ReportMapControlsProps) {
  const id = useId().replaceAll(":", "");
  const selected = new Set(selectedYears);
  const allYears = selectedYears.length === 0;

  return <div className="report-map-controls">
    <div className="report-map-control-group">
      <span className="report-map-control-label" id={`${id}-scope`}>Map scope</span>
      <div className="report-map-segments" role="group" aria-labelledby={`${id}-scope`}>
        <button type="button" className={scope === "cluster" ? "active" : ""} aria-pressed={scope === "cluster"} onClick={() => onScopeChange("cluster")}>Current cluster</button>
        <button type="button" className={scope === "all" ? "active" : ""} aria-pressed={scope === "all"} onClick={() => onScopeChange("all")}>All YC</button>
      </div>
    </div>
    <div className="report-map-control-group report-map-year-group">
      <span className="report-map-control-label" id={`${id}-years`}>YC years</span>
      <div className="report-map-years" role="group" aria-labelledby={`${id}-years`}>
        <button type="button" className={allYears ? "active" : ""} aria-pressed={allYears} onClick={() => onSelectedYearsChange([])}>All years</button>
        {years.map((year) => {
          const active = selected.has(year);
          return <button
            type="button"
            className={active ? "active" : ""}
            aria-pressed={active}
            key={year}
            onClick={() => onSelectedYearsChange(toggleReportMapYear(selectedYears, year))}
          >
            <i aria-hidden="true" style={{ "--map-year-color": reportMapColor(year) } as CSSProperties} />
            {year}
          </button>;
        })}
      </div>
    </div>
    <div className="report-map-count" aria-live="polite">
      <strong>{visibleCount.toLocaleString("en")}</strong>
      <span>{visibleCount === scopeCount ? "companies shown" : `of ${scopeCount.toLocaleString("en")} companies`}</span>
      {pinnedNote && <small>{pinnedNote}</small>}
    </div>
  </div>;
}
