import { BatchGrowthExplorer } from "@/components/batch-growth-explorer";
import { loadBatchGrowthPageData } from "@/lib/yc/batch-growth-data";
import { MILESTONES, RAMP_ANCHOR_COUNT } from "@/lib/yc/batch-growth-chart";

export function BatchGrowthSection() {
  const { view, additions, additionsWindowDays, additionsSince, addedInWindow, directoryTotal, fastestToFifty, latestBatch } =
    loadBatchGrowthPageData();
  const longestGap = [...view.gaps].sort((left, right) => right.days - left.days)[0];

  return (
    <section className="growth-band" id="batch-growth">
      <div className="growth-heading">
        <p className="eyebrow">Batch ramp speed</p>
        <h2>How fast a batch fills up.</h2>
      </div>
      <div className="growth-intro">
        <p>
          YC announces a batch a few companies at a time. Each line below is one batch&rsquo;s cumulative company count,
          measured from the day it first reached {`${RAMP_ANCHOR_COUNT} companies`}&mdash;so batches overlay and their
          ramp speeds compare directly. Reconstructed from the daily commit history of the public{" "}
          <a href="https://github.com/yc-oss/api" target="_blank" rel="noreferrer">yc-oss/api</a> mirror.
        </p>
        <div className="stats" aria-label="Batch growth summary">
          <div className="stat">
            <strong>{fastestToFifty ? `${fastestToFifty.days}d` : "—"}</strong>
            <span>{fastestToFifty ? `fastest to 50 · ${fastestToFifty.name}` : "fastest to 50"}</span>
          </div>
          <div className="stat">
            <strong>{latestBatch?.count.toLocaleString() ?? "—"}</strong>
            <span>{latestBatch ? `in ${latestBatch.name}, day ${latestBatch.days}` : "newest batch"}</span>
          </div>
          <div className="stat">
            <strong>{addedInWindow.toLocaleString()}</strong>
            <span>added in {additionsWindowDays} days</span>
          </div>
        </div>
      </div>

      <BatchGrowthExplorer
        view={view}
        additions={additions}
        additionsSince={additionsSince}
        directoryTotal={directoryTotal}
      />

      <details className="growth-table-details">
        <summary>Show the ramp data as a table</summary>
        <div className="growth-table-wrap">
          <table className="growth-table">
            <caption>
              Days from {`${RAMP_ANCHOR_COUNT} companies`} to each milestone. A dash means the batch never reached it.
            </caption>
            <thead>
              <tr>
                <th scope="col">Batch</th>
                {MILESTONES.map((target) => <th key={target} scope="col">To {target}</th>)}
                <th scope="col">Now</th>
              </tr>
            </thead>
            <tbody>
              {view.series.map((series) => (
                <tr key={series.key}>
                  <th scope="row">{series.name}</th>
                  {series.milestones.map((milestone) => (
                    <td key={milestone.target}>{milestone.days === null ? "—" : `${milestone.days}d`}</td>
                  ))}
                  <td>{series.latestCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="growth-note">
        The mirror samples once a day and has gaps
        {longestGap ? ` — the longest ran ${longestGap.days} days from ${longestGap.start}` : ""}, so a change on an
        unsampled day is attributed to the next sampled one. Per-company additions only go back to {additionsSince}.
        {view.excluded.length > 0 && (
          <>
            {" "}
            {view.excluded.map((batch) => batch.name).join(" and ")} {view.excluded.length > 1 ? "are" : "is"} left off
            the chart because most of {view.excluded.length > 1 ? "their" : "its"} growth landed inside a gap.
          </>
        )}
      </p>
    </section>
  );
}
