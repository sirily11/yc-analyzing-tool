import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The requested Application Signal page could not be found.",
};

export default function NotFound() {
  return (
    <main className="status-page">
      <header className="status-topbar">
        <Link href="/" className="brand" aria-label="Application Signal home">
          <span className="brand-mark">A</span>
          <span>APPLICATION SIGNAL</span>
        </Link>
        <span className="topbar-meta">DIRECTORY SYSTEM · ROUTE LOOKUP</span>
      </header>

      <section className="status-stage" aria-labelledby="not-found-title">
        <div className="status-code" aria-hidden="true">404</div>
        <div className="status-copy">
          <p className="eyebrow">No matching coordinate</p>
          <h1 id="not-found-title">This page is off the map.</h1>
          <p>
            The address may have changed, or the page may no longer exist.
            Return to the public directory and pick up the signal there.
          </p>
          <div className="status-actions">
            <Link className="button-dark" href="/">
              <ArrowLeft size={15} /> Return home
            </Link>
            <Link className="button-ghost" href="/#methodology">
              <Compass size={15} /> View methodology
            </Link>
          </div>
        </div>
        <div className="status-readout" aria-hidden="true">
          <span>Requested route</span>
          <strong>Not indexed</strong>
          <i />
          <small>Search complete · 0 matches</small>
        </div>
      </section>

      <footer className="status-footer">
        <span>Error 404 · Resource not found</span>
        <span>Application Signal</span>
      </footer>
    </main>
  );
}
