"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="status-page status-page-error">
      <header className="status-topbar">
        <Link href="/" className="brand" aria-label="Application Signal home">
          <span className="brand-mark">A</span>
          <span>APPLICATION SIGNAL</span>
        </Link>
        <span className="topbar-meta">SYSTEM STATUS · INTERRUPTED</span>
      </header>

      <section className="status-stage" aria-labelledby="error-title">
        <div className="status-code" aria-hidden="true">ERR</div>
        <div className="status-copy">
          <p className="eyebrow">Signal interrupted</p>
          <h1 id="error-title">We lost the thread.</h1>
          <p>
            Something unexpected stopped this page from loading. Try the request
            again, or return home while the signal resets.
          </p>
          <div className="status-actions">
            <button className="button-primary" type="button" onClick={reset}>
              <RotateCcw size={15} /> Try again
            </button>
            <Link className="button-ghost" href="/">
              <ArrowLeft size={15} /> Return home
            </Link>
          </div>
        </div>
        <div className="status-readout" aria-hidden="true">
          <span>System response</span>
          <strong>Connection lost</strong>
          <i />
          <small>{error.digest ? `Reference · ${error.digest}` : "Recovery available"}</small>
        </div>
      </section>

      <footer className="status-footer">
        <span>Runtime error · Retry available</span>
        <span>Application Signal</span>
      </footer>
    </main>
  );
}
