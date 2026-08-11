"use client";

import { useMemo, useState } from "react";
import type { BatchAdditionCompany } from "@/lib/yc/batch-growth";
import {
  BATCH_GROWTH_PADDING,
  RAMP_ANCHOR_COUNT,
  countAtDay,
  countToY,
  dateForDay,
  dayToX,
  nearestDay,
  projectCurrentBatch,
  type BatchGrowthView,
} from "@/lib/yc/batch-growth-chart";

const RECENT_PREVIEW_LIMIT = 12;

export function BatchGrowthExplorer({
  view,
  additions,
  additionsSince,
  directoryTotal,
}: {
  view: BatchGrowthView;
  additions: BatchAdditionCompany[];
  additionsSince: string;
  directoryTotal: number;
}) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  const visible = useMemo(() => view.series.filter((series) => !hidden.has(series.key)), [view.series, hidden]);
  const projection = useMemo(() => projectCurrentBatch(view), [view]);
  const current = view.series[view.series.length - 1] ?? null;
  const currentVisible = current ? !hidden.has(current.key) : false;

  // Relative days mean a different calendar date per batch, so date lookups are anchored to the
  // newest visible batch. Hiding the others is how you inspect a specific batch's dates.
  const reference = visible[visible.length - 1] ?? null;
  const selectedDate = reference && selectedDay !== null ? dateForDay(reference, selectedDay) : null;

  const selectedAdditions = useMemo(
    () => (selectedDate ? additions.filter((company) => company.addedOn === selectedDate) : null),
    [additions, selectedDate],
  );

  const toggle = (key: string) =>
    setHidden((next) => {
      const updated = new Set(next);
      if (!updated.delete(key)) updated.add(key);
      return updated;
    });

  if (view.series.length === 0) {
    return <p className="growth-empty">Not enough sampled history yet to chart batch ramps.</p>;
  }

  // Typed as MouseEvent so both onPointerMove and onClick can use it (PointerEvent extends it).
  const dayFromPointer = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return null;
    // The svg scales to its container, so convert the client x back into viewBox units.
    return nearestDay(view, ((event.clientX - rect.left) / rect.width) * view.width);
  };

  const activeDay = hoverDay ?? selectedDay;
  const readout = activeDay === null ? null : visible
    .map((series) => ({ series, count: countAtDay(series, activeDay) }))
    .filter((entry): entry is { series: (typeof visible)[number]; count: number } => entry.count !== null)
    .sort((left, right) => right.count - left.count);

  return (
    <div className="growth-body">
      <div className="growth-chart-panel">
        <div className="growth-chart-header">
          <span className="section-index">01 / Ramp</span>
          <span className="map-hint">Click the chart for a day · click the legend to hide a batch</span>
        </div>

        <div className="growth-chart">
          <svg
            className="growth-chart-svg"
            viewBox={`0 0 ${view.width} ${view.height}`}
            role="img"
            aria-label={view.ariaLabel}
            onPointerMove={(event) => setHoverDay(dayFromPointer(event))}
            onPointerLeave={() => setHoverDay(null)}
            onPointerCancel={() => setHoverDay(null)}
            onClick={(event) => {
              const day = dayFromPointer(event);
              setSelectedDay((previous) => (previous === day ? null : day));
            }}
          >
            {view.yTicks.map((tick) => (
              <g key={`y-${tick.value}`}>
                <line className="growth-grid-line" x1={BATCH_GROWTH_PADDING.left} x2={view.width - BATCH_GROWTH_PADDING.right} y1={tick.y} y2={tick.y} />
                <text className="growth-axis-label" x={BATCH_GROWTH_PADDING.left - 8} y={tick.y + 3} textAnchor="end">{tick.label}</text>
              </g>
            ))}
            {view.xTicks.map((tick) => (
              <text key={`x-${tick.value}`} className="growth-axis-label" x={tick.x} y={view.height - BATCH_GROWTH_PADDING.bottom + 18} textAnchor="middle">
                {tick.label}
              </text>
            ))}
            <text className="growth-axis-title" x={(view.width + BATCH_GROWTH_PADDING.left) / 2} y={view.height - 6} textAnchor="middle">
              Days since the batch reached {`${RAMP_ANCHOR_COUNT} companies`}
            </text>

            {selectedDay !== null && (
              <line className="growth-selected" x1={dayToX(view, selectedDay)} x2={dayToX(view, selectedDay)} y1={BATCH_GROWTH_PADDING.top} y2={view.height - BATCH_GROWTH_PADDING.bottom} />
            )}
            {hoverDay !== null && (
              <line className="growth-cursor" x1={dayToX(view, hoverDay)} x2={dayToX(view, hoverDay)} y1={BATCH_GROWTH_PADDING.top} y2={view.height - BATCH_GROWTH_PADDING.bottom} />
            )}

            {visible.map((series) =>
              series.segments.map((segment, index) => (
                <path
                  key={`${series.key}-${index}`}
                  className={`growth-series ${segment.observed ? "" : "unobserved"}`}
                  d={segment.d}
                  stroke={series.color}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}

            {/* Where the newest batch stands today, so it can be read against the finished ramps. */}
            {current && currentVisible && projection && (
              <g className="growth-today">
                <circle cx={dayToX(view, projection.day)} cy={countToY(view, projection.count)} r={6} fill="none" stroke={current.color} strokeWidth={1.5} />
                <circle cx={dayToX(view, projection.day)} cy={countToY(view, projection.count)} r={2.5} fill={current.color} />
                <text className="growth-today-label" x={dayToX(view, projection.day) + 10} y={countToY(view, projection.count) - 8}>
                  Today · {current.name} · {projection.count}
                </text>
              </g>
            )}

            {activeDay !== null && readout?.map((entry) => (
              <circle
                key={`dot-${entry.series.key}`}
                className="growth-series-point"
                cx={dayToX(view, activeDay)}
                cy={countToY(view, entry.count)}
                r={3.5}
                fill={entry.series.color}
              />
            ))}
          </svg>

          <div className="growth-readout" aria-live="polite">
            {visible.length === 0 ? (
              <span className="mono-label">Every batch is hidden &mdash; pick one from the legend below</span>
            ) : readout?.length ? (
              <>
                <span className="mono-label">
                  Day {activeDay}
                  {reference && selectedDay !== null && activeDay === selectedDay
                    ? ` · ${dateForDay(reference, selectedDay)}`
                    : ""}
                </span>
                {readout.map((entry) => (
                  <span className="growth-readout-row" key={entry.series.key}>
                    <span className="legend-dot" style={{ background: entry.series.color }} />
                    {entry.series.name}
                    <strong>{entry.count}</strong>
                  </span>
                ))}
              </>
            ) : (
              <span className="mono-label">Hover to compare batches on the same day · click to pin a date</span>
            )}
          </div>

          <div className="legend">
            {view.series.map((series) => {
              const shown = !hidden.has(series.key);
              return (
                <button
                  key={series.key}
                  type="button"
                  className="growth-legend-toggle"
                  aria-pressed={shown}
                  title={`${shown ? "Hide" : "Show"} ${series.name}`}
                  onClick={() => toggle(series.key)}
                >
                  <span className="legend-dot" style={{ background: series.color }} />
                  {series.name}
                </button>
              );
            })}
            {hidden.size > 0 ? (
              <button type="button" className="text-action" onClick={() => setHidden(new Set())}>
                Show all ({hidden.size} hidden)
              </button>
            ) : (
              view.series.length > 1 && (
                <button
                  type="button"
                  className="text-action"
                  onClick={() => setHidden(new Set(view.series.slice(0, -1).map((series) => series.key)))}
                >
                  Latest only
                </button>
              )
            )}
          </div>
        </div>

        {projection && (
          <div className="growth-projection">
            <p className="eyebrow">How many more to expect</p>
            <p>
              <strong>{projection.name}</strong> is on day {projection.day} with {projection.count} companies. At the
              same point, the {projection.comparisons.length} earlier batches below went on to finish between{" "}
              <strong>{projection.low}</strong> and <strong>{projection.high}</strong> &mdash; a median of{" "}
              <strong>{projection.median}</strong>.
            </p>
            <div className="growth-projection-grid">
              {projection.comparisons.map((comparison) => (
                <span key={comparison.name}>
                  <span className="mono-label">{comparison.name}</span>
                  {comparison.atSameDay} &rarr; {comparison.final}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="growth-additions">
        <div className="panel-heading">
          <span className="section-index">02 / Newly added</span>
          <span className="map-hint">{directoryTotal ? `${directoryTotal.toLocaleString()} total` : ""}</span>
        </div>

        {selectedDate ? (
          <div className="growth-additions-filter">
            <span className="mono-label">
              Added {selectedDate}
              {reference ? ` · ${reference.name} day ${selectedDay}` : ""}
            </span>
            <button type="button" className="text-action" onClick={() => setSelectedDay(null)}>
              Clear
            </button>
          </div>
        ) : (
          <p className="growth-additions-hint">Click the chart to see the companies added on a given day.</p>
        )}

        <AdditionsList
          companies={selectedAdditions ?? additions.slice(0, RECENT_PREVIEW_LIMIT)}
          emptyMessage={
            selectedDate
              ? selectedDate < additionsSince
                ? `Per-company history only goes back to ${additionsSince}.`
                : "No companies were added to the directory on this day."
              : "No companies have been added in the tracked window."
          }
        />
      </aside>
    </div>
  );
}

function AdditionsList({ companies, emptyMessage }: { companies: BatchAdditionCompany[]; emptyMessage: string }) {
  if (companies.length === 0) return <p className="growth-empty">{emptyMessage}</p>;
  return (
    <div className="company-list" aria-label="Newly added YC companies">
      {companies.map((company) => (
        <a className="company-row" key={company.id} href={company.url} target="_blank" rel="noreferrer">
          <span className="company-initial">{company.name.slice(0, 1)}</span>
          <span>
            <strong>{company.name}</strong>
            <span>{[company.batch, company.oneLiner].filter(Boolean).join(" · ")}</span>
            <span className="addition-meta">{[company.addedOn, company.industry, company.location].filter(Boolean).join(" · ")}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
