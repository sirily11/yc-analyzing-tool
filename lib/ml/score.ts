export function calibrateFitScore(reconstructionError: number, acceptedErrors: number[]) {
  if (!Number.isFinite(reconstructionError) || acceptedErrors.length < 2) throw new Error("A finite error and at least two calibration points are required.");
  const sorted = acceptedErrors.filter(Number.isFinite).sort((a, b) => a - b);
  const notBetter = sorted.filter((value) => value >= reconstructionError).length;
  return Math.max(0, Math.min(100, Math.round((notBetter / sorted.length) * 100)));
}
