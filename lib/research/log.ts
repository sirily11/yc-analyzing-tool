import "server-only";

type ResearchLogFields = Record<string, string | number | boolean | null | undefined>;
type ResearchLogLevel = "info" | "warn" | "error";

/**
 * Structured research lifecycle logging. Callers must pass identifiers, counts,
 * and status codes only—never crawled text, candidate source text, or secrets.
 */
export function researchLog(level: ResearchLogLevel, event: string, fields: ResearchLogFields = {}) {
  if (process.env.NODE_ENV === "test") return;
  const payload = {
    event,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  };
  if (level === "error") console.error("[report-research]", payload);
  else if (level === "warn") console.warn("[report-research]", payload);
  else console.info("[report-research]", payload);
}

export function researchErrorCode(cause: unknown) {
  if (cause instanceof DOMException && cause.name === "TimeoutError") return "TIMEOUT";
  if (cause instanceof TypeError) return "NETWORK_ERROR";
  if (cause instanceof Error && /^FIRECRAWL_[A-Z0-9_]+$/.test(cause.message)) return cause.message;
  return "UNEXPECTED_ERROR";
}
