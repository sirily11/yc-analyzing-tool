"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, LoaderCircle, Search, Sparkles } from "lucide-react";

type Progress = {
  status: "processing" | "researching" | "drafting" | "complete" | "failed";
  jobs: { total: number; running: number; complete: number; failed: number };
};

export function ReportResearchProgress({ reportId, companyName, initialStatus }: { reportId: string; companyName: string; initialStatus: Progress["status"] }) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>({ status: initialStatus, jobs: { total: 0, running: 0, complete: 0, failed: 0 } });
  const [requestFailed, setRequestFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/status`, { method: "POST" });
        if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
        const value = await response.json() as Progress;
        if (stopped) return;
        setProgress(value);
        setRequestFailed(false);
        if (value.status === "complete") {
          router.refresh();
          return;
        }
        if (value.status === "failed") return;
      } catch {
        if (!stopped) setRequestFailed(true);
      }
      if (!stopped) timer = setTimeout(poll, 5_000);
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [reportId, router]);

  const researchDone = progress.status === "drafting" || progress.status === "complete";
  return <main className="report-page report-progress-page">
    <header className="report-topbar"><Link href="/dashboard"><ArrowLeft size={15} /> Back to reports</Link><span className="brand"><span className="brand-mark">A</span> APPLICATION SIGNAL</span><span /></header>
    <section className="report-progress-hero">
      <p className="eyebrow">Private research in progress</p>
      <h1>{companyName}</h1>
      <p>The score is locked. Application Signal is researching five public comparable companies before drafting the coaching dossier.</p>
      <div className="research-progress-list" aria-live="polite">
        <article className="complete"><span><Check size={17} /></span><div><strong>Application profile and fit score</strong><p>The browser-generated score and model versions cannot be changed by web research.</p></div></article>
        <article className={researchDone ? "complete" : "active"}><span>{researchDone ? <Check size={17} /> : <Search size={17} />}</span><div><strong>Public comparable-company research</strong><p>{progress.jobs.total ? `${progress.jobs.complete} of ${progress.jobs.total} bounded jobs complete${progress.jobs.failed ? ` · ${progress.jobs.failed} unavailable` : ""}.` : "Starting Firecrawl search and website crawls."}</p></div>{!researchDone && <LoaderCircle className="spin" size={17} />}</article>
        <article className={progress.status === "drafting" ? "active" : progress.status === "complete" ? "complete" : ""}><span>{progress.status === "complete" ? <Check size={17} /> : <Sparkles size={17} />}</span><div><strong>Evidence-led report drafting</strong><p>{progress.status === "drafting" ? "Writing the dossier and validating every source reference." : "Queued after public research finishes."}</p></div>{progress.status === "drafting" && <LoaderCircle className="spin" size={17} />}</article>
      </div>
      {progress.status === "failed" && <p className="research-progress-warning">This report could not complete. Return to the conversation to retry with a new immutable report.</p>}
      {requestFailed && <p className="research-progress-warning">The latest status check failed. This page will retry automatically.</p>}
      <small>You can leave this page; signed Firecrawl webhooks continue the report in the background.</small>
    </section>
  </main>;
}
