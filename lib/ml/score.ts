export function calibrateFitScore(reconstructionError: number, acceptedErrors: number[]) {
  if (!Number.isFinite(reconstructionError) || acceptedErrors.length < 2) throw new Error("A finite error and at least two calibration points are required.");
  const sorted = acceptedErrors.filter(Number.isFinite).sort((a, b) => a - b);
  const notBetter = sorted.filter((value) => value >= reconstructionError).length;
  return Math.max(0, Math.min(100, Math.round((notBetter / sorted.length) * 100)));
}

export function blendFounderAwareScore(startupFit: number, founderFit: number | null, founderWeight = 0.3) {
  if (![startupFit, founderFit ?? 0, founderWeight].every(Number.isFinite) || founderWeight < 0 || founderWeight > 1) {
    throw new Error("Finite fit scores and a founder weight between zero and one are required.");
  }
  if (founderFit === null) return { score: Math.round(startupFit), startupWeight: 1, founderWeight: 0 };
  const startupWeight = 1 - founderWeight;
  return { score: Math.round(startupFit * startupWeight + founderFit * founderWeight), startupWeight, founderWeight };
}
