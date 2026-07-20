"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanyDetail } from "@/components/company-detail";
import type { DatasetManifest, YcCompany } from "@/lib/types/company";

const FIRST_DIRECTORY_YEAR = 2020;
const DIRECTORY_YEARS = Array.from(
  { length: new Date().getUTCFullYear() - FIRST_DIRECTORY_YEAR + 1 },
  (_, index) => FIRST_DIRECTORY_YEAR + index,
);
const YEAR_PALETTE = ["#8d5f4d", "#b06f45", "#d55b38", "#b78b3d", "#5478a8", "#806b9f", "#315f49", "#3f7287", "#9b5b75"];
const YEAR_COLORS = Object.fromEntries(
  DIRECTORY_YEARS.map((value, index) => [value, YEAR_PALETTE[index % YEAR_PALETTE.length]]),
) as Record<number, string>;

type Pointer = { x: number; y: number; company: YcCompany } | null;

export function PublicExplorer() {
  const [companies, setCompanies] = useState<YcCompany[]>([]);
  const [directory, setDirectory] = useState<YcCompany[]>([]);
  const [manifest, setManifest] = useState<DatasetManifest | null>(null);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState<number | null>(null);
  const [industry, setIndustry] = useState("All sectors");
  const [market, setMarket] = useState("All markets");
  const [area, setArea] = useState("All areas");
  const [pointer, setPointer] = useState<Pointer>(null);
  const [selected, setSelected] = useState<YcCompany | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/yc/companies", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("YC_DIRECTORY_UNAVAILABLE");
        return response.json() as Promise<{ companies: YcCompany[]; manifest: DatasetManifest }>;
      })
      .then((result) => {
        setDirectory(result.companies);
        setManifest(result.manifest);
        setDirectoryError(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setDirectoryError(cause instanceof Error ? cause.message : "YC_DIRECTORY_UNAVAILABLE");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDirectoryLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const hasSearchOrFilters = Boolean(query.trim() || year || industry !== "All sectors" || market !== "All markets" || area !== "All areas");
    if (!hasSearchOrFilters) {
      setCompanies(directory);
      setPointer(null);
      setSelected((current) => current && directory.some((company) => company.id === current.id) ? current : null);
      return;
    }
    const controller = new AbortController();
    const delay = query.trim() ? 450 : 0;
    const timeout = window.setTimeout(async () => {
      const parameters = new URLSearchParams();
      if (query.trim()) parameters.set("query", query.trim());
      if (year) parameters.set("year", String(year));
      if (industry !== "All sectors") parameters.set("industry", industry);
      if (market !== "All markets") parameters.set("targetMarket", market);
      if (area !== "All areas") parameters.set("operatingArea", area);
      setSearching(true);
      setDirectoryError(null);
      try {
        const response = await fetch(`/api/yc/companies?${parameters}`, { signal: controller.signal });
        if (!response.ok) throw new Error("YC_DIRECTORY_UNAVAILABLE");
        const result = await response.json() as { companies: YcCompany[]; manifest: DatasetManifest };
        setCompanies(result.companies);
        setManifest(result.manifest);
        setPointer(null);
        setSelected((current) => current && result.companies.some((company) => company.id === current.id) ? current : null);
      } catch (cause) {
        if (!controller.signal.aborted) setDirectoryError(cause instanceof Error ? cause.message : "YC_DIRECTORY_UNAVAILABLE");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, year, industry, market, area, directory]);

  useEffect(() => {
    if (!filtersOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [filtersOpen]);

  const industries = useMemo(() => [...new Set(directory.map((item) => item.industry))].sort(), [directory]);
  const markets = useMemo(() => [...new Set(directory.map((item) => item.targetMarket))].sort(), [directory]);
  const areas = useMemo(() => [...new Set(directory.map((item) => item.operatingArea))].sort(), [directory]);
  const visible = companies;

  const reset = () => {
    setQuery(""); setYear(null); setIndustry("All sectors"); setMarket("All markets"); setArea("All areas"); setPointer(null); setSelected(null);
  };
  const aiDensity = visible.length ? Math.round((visible.filter((item) => item.aiLinked).length / visible.length) * 100) : 0;
  const sfDensity = visible.length ? Math.round((visible.filter((item) => item.operatingArea === "SF Bay Area").length / visible.length) * 100) : 0;
  const hiringCount = visible.filter((item) => item.hiring).length;
  const marketCounts = visible.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.targetMarket]: (acc[item.targetMarket] ?? 0) + 1 }), {});
  const topMarket = Object.entries(marketCounts).sort((a, b) => b[1] - a[1])[0];
  const highlighted = selected ?? pointer?.company ?? null;
  const readout = highlighted ? [highlighted, ...visible.filter((item) => item.id !== highlighted.id).slice(0, 5)] : visible.slice(0, 6);
  const activeFilterCount = [query.trim(), year, industry !== "All sectors", market !== "All markets", area !== "All areas"].filter(Boolean).length;

  return (
    <>
      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Public Y Combinator companies from 2020 to today</p>
          <h1>See where your startup fits.</h1>
        </div>
        <div className="hero-aside">
          <p>Explore the patterns across recent YC companies—then turn your business plan into a private, evidence-led fit report.</p>
          <div className="stats" aria-label="Dataset summary">
            <div className="stat"><strong>{(manifest?.companyCount ?? companies.length).toLocaleString()}</strong><span>companies</span></div>
            <div className="stat"><strong>{directory.length ? Math.round(directory.filter((item) => item.aiLinked).length / directory.length * 100) : 0}%</strong><span>AI-linked</span></div>
            <div className="stat"><strong>{manifest?.batches.length ?? "—"}</strong><span>batches</span></div>
          </div>
        </div>
      </section>

      <section className="explorer-frame" aria-label="YC company relationship explorer">
        <button className="mobile-filter-trigger" type="button" aria-expanded={filtersOpen} aria-controls="directory-filters" onClick={() => setFiltersOpen(true)}>
          <span>Filter the signal map{activeFilterCount ? ` · ${activeFilterCount} active` : ""}</span>
          <strong>{visible.length.toLocaleString()} visible</strong>
        </button>
        {filtersOpen && <button className="filter-backdrop" type="button" aria-label="Close directory filters" onClick={() => setFiltersOpen(false)} />}
        <aside id="directory-filters" className={`explorer-panel filter-panel ${filtersOpen ? "open" : ""}`} role={filtersOpen ? "dialog" : undefined} aria-modal={filtersOpen || undefined} aria-label={filtersOpen ? "Directory filters" : undefined}>
          <div className="panel-heading"><span className="section-index">01 / Filter</span><span className="filter-heading-actions"><button className="text-action" onClick={reset}>Reset</button><button className="text-action mobile-sheet-close" onClick={() => setFiltersOpen(false)}>Close</button></span></div>
          <div className="field"><label htmlFor="company-search">Describe a company or theme</label><input id="company-search" className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. tools that automate warehouse operations" type="search" /></div>
          <div className="field"><label>Batch year</label><div className="year-grid">{[null, ...DIRECTORY_YEARS].map((item) => <button key={item ?? "all"} className={`year-button ${year === item ? "active" : ""}`} onClick={() => setYear(item)}>{item ? String(item).slice(2) : "All"}</button>)}</div></div>
          <FilterSelect id="industry" label="YC industry" value={industry} onChange={setIndustry} all="All sectors" values={industries} />
          <FilterSelect id="market" label="Target market" value={market} onChange={setMarket} all="All markets" values={markets} />
          <FilterSelect id="area" label="Operating area" value={area} onChange={setArea} all="All areas" values={areas} />
          <div className="filter-metrics">
            <div className="filter-metric"><span>{searching || directoryLoading ? "Searching" : "Visible"}</span><strong>{searching || directoryLoading ? "…" : visible.length.toLocaleString()}</strong></div>
            <div className="filter-metric"><span>AI-linked</span><strong>{aiDensity}%</strong></div>
            <div className="filter-metric"><span>SF Bay</span><strong>{sfDensity}%</strong></div>
            <div className="filter-metric"><span>Hiring</span><strong>{hiringCount.toLocaleString()}</strong></div>
          </div>
          <button className="mobile-filter-submit" type="button" onClick={() => setFiltersOpen(false)}>Show {visible.length.toLocaleString()} companies</button>
          {directoryError && <p role="alert">The YC directory is temporarily unavailable.</p>}
        </aside>
        <CompanyMap companies={visible} pointer={pointer} selected={selected} onPointer={setPointer} onSelect={setSelected} />
        <aside className={`explorer-panel readout ${selected ? "company-detail-open" : ""}`}>
          {selected ? <CompanyDetail company={selected} onClose={() => setSelected(null)} /> : <>
            <div className="panel-heading"><span className="section-index">03 / Readout</span><button className="text-action" onClick={() => visible.length && setSelected(visible[Math.floor(Math.random() * visible.length)])}>Surprise me</button></div>
            <div className="readout-card"><p className="eyebrow">AI density</p><strong>{aiDensity}%</strong><p>Share of visible companies whose public description or tags mention AI, agents, LLMs, or machine learning.</p></div>
            <div className="readout-card"><p className="eyebrow">Leading market</p><strong>{topMarket?.[1]?.toLocaleString() ?? "—"}</strong><p>{topMarket?.[0] ?? "No matching companies"} is the largest inferred customer market in this view.</p></div>
            <div className="company-list" aria-label="Visible companies">
              {readout.map((company) => <button key={company.id} className="company-row" onClick={() => setSelected(company)}><span className="company-initial">{company.name.slice(0, 1)}</span><span><strong>{company.name}</strong><span>{company.oneLiner}</span></span></button>)}
            </div>
          </>}
        </aside>
      </section>
    </>
  );
}

function FilterSelect({ id, label, value, onChange, all, values }: { id: string; label: string; value: string; onChange: (value: string) => void; all: string; values: string[] }) {
  return <div className="field"><label htmlFor={id}>{label}</label><select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value)}><option>{all}</option>{values.map((item) => <option key={item}>{item}</option>)}</select></div>;
}

function CompanyMap({ companies, pointer, selected, onPointer, onSelect }: { companies: YcCompany[]; pointer: Pointer; selected: YcCompany | null; onPointer: (pointer: Pointer) => void; onSelect: (company: YcCompany) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 1, height: 1 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = sizeRef.current;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
    for (const company of companies) {
      const x = company.x * width; const y = company.y * height;
      const active = pointer?.company.id === company.id || selected?.id === company.id;
      context.beginPath(); context.arc(x, y, active ? 6 : 2.25, 0, Math.PI * 2);
      context.fillStyle = active ? "#25211d" : YEAR_COLORS[company.year] ?? "#70695f";
      context.globalAlpha = active ? 1 : 0.76; context.fill();
      if (active) { context.strokeStyle = "#f3efe5"; context.lineWidth = 2; context.stroke(); }
    }
    context.globalAlpha = 1;
  }, [companies, pointer, selected]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => { sizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height }; draw(); });
    observer.observe(canvas); return () => observer.disconnect();
  }, [draw]);
  useEffect(draw, [draw]);

  const locate = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
    let best: { company: YcCompany; distance: number } | null = null;
    for (const company of companies) {
      const distance = Math.hypot(company.x * rect.width - x, company.y * rect.height - y);
      if (distance < 10 && (!best || distance < best.distance)) best = { company, distance };
    }
    return best ? { x, y, company: best.company } : null;
  };

  return <div className="map-panel"><div className="map-panel-header"><span className="section-index">02 / Signal map</span><span className="map-hint">Hover to preview · click for details</span></div><div className="map-explainer" id="signal-map-explanation"><span>How to read the map</span><p><strong>Distance is the signal.</strong> Nearby dots represent companies with similar model profiles. X and Y are normalized layout coordinates—not individual business metrics or scores.</p></div><div className="map-wrap"><span className="map-axis left">X · learned horizontal position →</span><span className="map-axis right">Y · learned vertical position ↓</span><canvas ref={canvasRef} className="map-canvas" onPointerMove={(event) => onPointer(locate(event))} onPointerLeave={() => onPointer(null)} onClick={(event) => { const match = locate(event); if (match) onSelect(match.company); }} aria-label={`Dot map of ${companies.length} public YC companies. Click a dot to show company details.`} aria-describedby="signal-map-explanation" />{pointer && <div className="map-tooltip" style={{ left: Math.min(pointer.x, sizeRef.current.width - 275), top: Math.min(pointer.y, sizeRef.current.height - 112) }}><strong>{pointer.company.name} · {pointer.company.batch}</strong><span>{pointer.company.oneLiner}</span><span className="map-tooltip-coordinates">Click for founder and company details</span></div>}</div><div className="legend">{Object.entries(YEAR_COLORS).map(([item, color]) => <span className="legend-item" key={item}><span className="legend-dot" style={{ background: color }} />{item}</span>)}<span>Dot = public company</span><span>Closer = more similar</span></div></div>;
}
