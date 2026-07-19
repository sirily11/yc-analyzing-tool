import { describe, expect, it } from "vitest";
import { calibrateFitScore } from "@/lib/ml/score";

describe("fit score calibration", () => {
  it("rewards lower reconstruction error without calling it probability", () => {
    expect(calibrateFitScore(0.1, [0.1, 0.2, 0.3, 0.4])).toBe(100);
    expect(calibrateFitScore(0.3, [0.1, 0.2, 0.3, 0.4])).toBe(50);
    expect(calibrateFitScore(0.5, [0.1, 0.2, 0.3, 0.4])).toBe(0);
  });
});
