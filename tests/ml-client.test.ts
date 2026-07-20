import { afterEach, describe, expect, it, vi } from "vitest";
import { runFitPrediction } from "@/lib/ml/client";
import type { ApplicationProfile } from "@/lib/types/analysis";

describe("browser fit prediction", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("terminates the model worker when prediction is stopped", async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: Worker["onmessage"] = null;
      onerror: Worker["onerror"] = null;
      postMessage = vi.fn();
      terminate = vi.fn();

      constructor() { workers.push(this); }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const prediction = runFitPrediction({} as ApplicationProfile, vi.fn(), controller.signal);

    controller.abort();

    await expect(prediction).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
});
