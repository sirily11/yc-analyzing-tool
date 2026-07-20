"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, Search, Sparkles } from "lucide-react";
import { failCompanyClusterMap, runCompanyClusterMap, type CompanyClusterProgress } from "@/lib/ml/company-cluster";

type CompanyResearchStatus = "researching" | "mapping" | "complete" | "failed";

export function CompanyResearchProgress({ reportId, title, initialStatus }: { reportId: string; title: string; initialStatus: CompanyResearchStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyResearchStatus>(initialStatus);
  const [clusterProgress, setClusterProgress] = useState<CompanyClusterProgress | null>(null);
  const [requestFailed, setRequestFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let mappingStarted = false;

    const publishMap = async () => {
      if (mappingStarted) return;
      mappingStarted = true;
      let map;
      try {
        map = await runCompanyClusterMap(reportId, setClusterProgress, controller.signal);
      } catch {
        if (controller.signal.aborted) return;
        await failCompanyClusterMap(reportId).catch(() => undefined);
        setStatus("failed");
        return;
      }

      try {
        const response = await fetch(`/api/company-reports/${encodeURIComponent(reportId)}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ map }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const statusResponse = await fetch(`/api/company-reports/${encodeURIComponent(reportId)}`, { cache: "no-store", signal: controller.signal });
          const current = statusResponse.ok ? await statusResponse.json() as { status: CompanyResearchStatus } : null;
          if (current?.status === "complete") {
            router.refresh();
            return;
          }
          throw new Error(`Company report publication failed: ${response.status}`);
        }
        if (!controller.signal.aborted) router.refresh();
      } catch {
        if (controller.signal.aborted) return;
        setRequestFailed(true);
        mappingStarted = false;
        timer = setTimeout(poll, 3_000);
      }
    };

    const poll = async () => {
      try {
        const response = await fetch(`/api/company-reports/${encodeURIComponent(reportId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Company report status failed: ${response.status}`);
        const value = await response.json() as { status: CompanyResearchStatus };
        if (controller.signal.aborted) return;
        setStatus(value.status);
        setRequestFailed(false);
        if (value.status === "complete") {
          router.refresh();
          return;
        }
        if (value.status === "mapping") {
          void publishMap();
          return;
        }
        if (value.status === "failed") return;
      } catch {
        if (!controller.signal.aborted) setRequestFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3_000);
    };

    if (initialStatus === "mapping") void publishMap();
    else if (initialStatus === "complete") router.refresh();
    else if (initialStatus !== "failed") void poll();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [initialStatus, reportId, router]);

  const researchDone = status === "mapping" || status === "complete";
  const mappingCopy = clusterProgress?.label ?? (researchDone ? "Loading the active browser model and research signals." : "Queued after public research finishes.");
  return <main className="report-page report-progress-page">
    <header className="report-topbar"><Link href="/dashboard"><ArrowLeft size={15} /> Back to reports</Link><span className="brand"><span className="brand-mark">A</span> APPLICATION SIGNAL</span><span /></header>
    <section className="report-progress-hero">
      <p className="eyebrow">Private company report in progress</p>
      <h1>{title}</h1>
      <p>The durable research run continues outside this request. When its cited draft is ready, this page builds the versioned semantic map in your browser and publishes the report.</p>
      <div className="research-progress-list" aria-live="polite">
        <article className={researchDone ? "complete" : status === "researching" ? "active" : ""}><span>{researchDone ? <Check size={17} /> : <Search size={17} />}</span><div><strong>Public YC and website research</strong><p>{researchDone ? "The cited company draft is stored." : "Firecrawl research and evidence-led synthesis are running in Vercel Workflow."}</p></div>{status === "researching" && <LoaderCircle className="spin" size={17} />}</article>
        <article className={status === "complete" ? "complete" : status === "mapping" ? "active" : ""}><span>{status === "complete" ? <Check size={17} /> : <Sparkles size={17} />}</span><div><strong>Browser semantic map</strong><p>{mappingCopy}</p></div>{status === "mapping" && <LoaderCircle className="spin" size={17} />}</article>
      </div>
      {status === "failed" && <p className="research-progress-warning">This report could not complete. Start a new report from the source analysis to retry.</p>}
      {requestFailed && status !== "failed" && <p className="research-progress-warning">The latest status check failed. This page will retry automatically.</p>}
      <small>You can leave while public research runs. Reopen this report to complete its browser-only semantic map.</small>
    </section>
  </main>;
}
