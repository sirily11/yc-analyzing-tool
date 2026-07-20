"use client";

import type { ApplicationProfile, PredictionResult } from "@/lib/types/analysis";

export type ModelProgress = { stage: "loading" | "vectorizing" | "inference" | "neighbors"; progress: number; label: string };

export function runFitPrediction(profile: ApplicationProfile, onProgress: (progress: ModelProgress) => void, signal?: AbortSignal): Promise<PredictionResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/fit-model.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
    };
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Local prediction stopped.", "AbortError"));
    };
    if (signal?.aborted) { handleAbort(); return; }
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: "progress"; value: ModelProgress } | { type: "result"; value: PredictionResult } | { type: "error"; error: string }>) => {
      if (settled) return;
      if (event.data.type === "progress") onProgress(event.data.value);
      if (event.data.type === "result") { settled = true; cleanup(); resolve(event.data.value); }
      if (event.data.type === "error") { settled = true; cleanup(); reject(new Error(event.data.error)); }
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true; cleanup(); reject(new Error(event.message || "Local model worker failed."));
    };
    worker.postMessage({ profile });
  });
}
