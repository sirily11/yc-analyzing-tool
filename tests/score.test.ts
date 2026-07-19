import { describe, expect, it } from "vitest";
import { blendFounderAwareScore, calibrateFitScore } from "@/lib/ml/score";

describe("fit score calibration", () => {
  it("rewards lower reconstruction error without calling it probability", () => {
    expect(calibrateFitScore(0.1, [0.1, 0.2, 0.3, 0.4])).toBe(100);
    expect(calibrateFitScore(0.3, [0.1, 0.2, 0.3, 0.4])).toBe(50);
    expect(calibrateFitScore(0.5, [0.1, 0.2, 0.3, 0.4])).toBe(0);
  });
});

describe("founder-aware score blend", () => {
  it("applies the explicit 70/30 blend", () => {
    expect(blendFounderAwareScore(80, 60)).toEqual({ score: 74, startupWeight: 0.7, founderWeight: 0.3 });
  });

  it("leaves startup fit unchanged when founder evidence is missing", () => {
    expect(blendFounderAwareScore(67, null)).toEqual({ score: 67, startupWeight: 1, founderWeight: 0 });
  });
});
