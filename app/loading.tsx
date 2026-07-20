export default function Loading() {
  return (
    <main className="status-page status-page-loading" aria-busy="true" aria-live="polite">
      <header className="status-topbar">
        <span className="brand">
          <span className="brand-mark">A</span>
          <span>APPLICATION SIGNAL</span>
        </span>
        <span className="topbar-meta">SYSTEM STATUS · LOADING</span>
      </header>

      <section className="loading-stage">
        <div className="loading-orbit" aria-hidden="true">
          <span className="loading-axis loading-axis-x" />
          <span className="loading-axis loading-axis-y" />
          <span className="loading-ring loading-ring-outer" />
          <span className="loading-ring loading-ring-inner" />
          <span className="loading-sweep" />
          <i className="loading-point loading-point-one" />
          <i className="loading-point loading-point-two" />
          <i className="loading-point loading-point-three" />
        </div>
        <div className="loading-copy">
          <p className="eyebrow">Mapping the directory</p>
          <h1>Calibrating<br />the signal.</h1>
          <div className="loading-progress" aria-hidden="true"><span /></div>
          <p>Loading the latest view and placing every point in context.</p>
        </div>
      </section>

      <footer className="status-footer">
        <span>Working · Please stand by</span>
        <span>Application Signal</span>
      </footer>
    </main>
  );
}
