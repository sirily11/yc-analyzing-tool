"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="dashboard-page dashboard-state">
      <p className="eyebrow">Dashboard interrupted</p>
      <h1>We couldn’t load your workspace.</h1>
      <p>Your sidebar and conversations are still here. Retry the dashboard request or start a new analysis.</p>
      <div className="status-actions">
        <button className="button-primary" type="button" onClick={reset}>
          <RotateCcw size={15} /> Try again
        </button>
        <Link className="button-ghost" href="/chat/new">Start a new analysis</Link>
      </div>
    </div>
  );
}
