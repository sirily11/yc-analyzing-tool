export default function DashboardLoading() {
  return (
    <div className="dashboard-page dashboard-loading" aria-busy="true" aria-live="polite">
      <header className="dashboard-loading-header">
        <div>
          <span className="dashboard-loading-line dashboard-loading-eyebrow" />
          <span className="dashboard-loading-line dashboard-loading-title" />
          <span className="dashboard-loading-line dashboard-loading-subtitle" />
        </div>
        <span className="dashboard-loading-action" />
      </header>

      <section className="dashboard-stats dashboard-loading-stats" aria-label="Loading dashboard summary">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index}>
            <span className="dashboard-loading-line dashboard-loading-label" />
            <span className="dashboard-loading-line dashboard-loading-number" />
            <span className="dashboard-loading-line dashboard-loading-note" />
          </div>
        ))}
      </section>

      <section className="dashboard-section">
        <div className="dashboard-loading-section-heading">
          <div>
            <span className="dashboard-loading-line dashboard-loading-eyebrow" />
            <span className="dashboard-loading-line dashboard-loading-section-title" />
          </div>
          <span className="dashboard-loading-pill" />
        </div>
        <div className="dashboard-loading-toolbar" />
        <div className="dashboard-loading-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <article key={index}>
              <span className="dashboard-loading-line dashboard-loading-label" />
              <span className="dashboard-loading-line dashboard-loading-card-title" />
              <span className="dashboard-loading-line dashboard-loading-card-copy" />
              <span className="dashboard-loading-line dashboard-loading-card-copy short" />
            </article>
          ))}
        </div>
      </section>

      <p className="sr-only">Loading your dashboard.</p>
    </div>
  );
}
