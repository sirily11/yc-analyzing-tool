"use client";

import type { CompanyClusterMap } from "@/lib/types/company-research";

export type CompanyClusterProgress = { progress: number; label: string };

export async function failCompanyClusterMap(reportId: string) {
  const response = await fetch(`/api/company-reports/${encodeURIComponent(reportId)}/map-input`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error("Could not clear failed company map input.");
}

export async function runCompanyClusterMap(reportId: string, onProgress: (progress: CompanyClusterProgress) => void, signal?: AbortSignal): Promise<CompanyClusterMap> {
  const response = await fetch(`/api/company-reports/${encodeURIComponent(reportId)}/map-input`, { signal });
  if (!response.ok) throw new Error(response.status === 404 ? "Company research map input is unavailable." : "Could not load company research map input.");
  const { companyResearchMapInputSchema } = await import("@/lib/types/company-research");
  const mapInput = companyResearchMapInputSchema.parse(await response.json());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/company-cluster.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const cleanup = () => { signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => {
      if (settled) return;
      settled = true; cleanup(); reject(new DOMException("Company mapping stopped.", "AbortError"));
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: "progress"; value: CompanyClusterProgress } | { type: "result"; value: CompanyClusterMap } | { type: "error"; error: string }>) => {
      if (settled) return;
      if (event.data.type === "progress") onProgress(event.data.value);
      if (event.data.type === "result") { settled = true; cleanup(); resolve(event.data.value); }
      if (event.data.type === "error") { settled = true; cleanup(); reject(new Error(event.data.error)); }
    };
    worker.onerror = (event) => { if (!settled) { settled = true; cleanup(); reject(new Error(event.message || "Company map worker failed.")); } };
    worker.postMessage({ mapInput });
  });
}
