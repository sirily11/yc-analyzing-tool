export function resolveReportModel(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return environment.AI_REPORT_MODEL
    ?? environment.AI_ANALYSIS_MODEL
    ?? environment.AI_CHAT_MODEL
    ?? "openai/gpt-5-mini";
}

export function modelTemperature(model: string, temperature: number) {
  return /(?:^|\/)gpt-5(?:[.-]|$)/i.test(model) ? undefined : temperature;
}

export const appConfig = {
  name: "Application Signal",
  description: "An independent, data-informed YC application fit explorer.",
  chatModel: process.env.AI_CHAT_MODEL ?? "openai/gpt-5-mini",
  analysisModel:
    process.env.AI_ANALYSIS_MODEL ??
    process.env.AI_CHAT_MODEL ??
    "openai/gpt-5-mini",
  reportModel: resolveReportModel(),
  temperature: 0.2,
  pdf: {
    maxBytes: 20 * 1024 * 1024,
    maxPages: 50,
    maxCharacters: 150_000,
    minCharacters: 500,
  },
  reportResearch: {
    comparableCompanyLimit: 5,
    websitePageLimit: 5,
    relatedSourceLimit: 4,
    cacheMaxAgeMs: 24 * 60 * 60 * 1_000,
    deadlineMs: 10 * 60 * 1_000,
    maxSourceCharacters: 12_000,
    maxCompanyCharacters: 60_000,
  },
  datasetVersion: "yc-2022-2026-ytd-v2",
  modelVersion: "browser-fit-v2",
  // Public HTTPS URL for the versioned model ZIP in S3.
  modelArchiveUrl: "https://s3bot.rxlab.app/yc-models/55852f36-84f4-48ff-9713-bff225ccc61e-browser-fit-v2.zip",
} as const;

export const hasGatewayConfig = Boolean(process.env.AI_GATEWAY_API_KEY);
export const hasFirecrawlConfig = Boolean(process.env.FIRECRAWL_API_KEY);
