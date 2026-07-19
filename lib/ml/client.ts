"use client";

import type { ApplicationProfile, PredictionResult } from "@/lib/types/analysis";

export type ModelProgress = { stage: "loading" | "vectorizing" | "inference" | "neighbors"; progress: number; label: string };

export function runFitPrediction(profile: ApplicationProfile, onProgress: (progress: ModelProgress) => void): Promise<PredictionResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/fit-model.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type: "progress"; value: ModelProgress } | { type: "result"; value: PredictionResult } | { type: "error"; error: string }>) => {
      if (event.data.type === "progress") onProgress(event.data.value);
      if (event.data.type === "result") { resolve(event.data.value); worker.terminate(); }
      if (event.data.type === "error") { reject(new Error(event.data.error)); worker.terminate(); }
    };
    worker.onerror = (event) => { reject(new Error(event.message || "Local model worker failed.")); worker.terminate(); };
    worker.postMessage({ profile });
  });
}
