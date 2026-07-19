export const appConfig = {
  name: "Application Signal",
  description: "An independent, data-informed YC application fit explorer.",
  chatModel: process.env.AI_CHAT_MODEL ?? "openai/gpt-5-mini",
  analysisModel:
    process.env.AI_ANALYSIS_MODEL ??
    process.env.AI_CHAT_MODEL ??
    "openai/gpt-5-mini",
  maxToolSteps: 6,
  temperature: 0.2,
  pdf: {
    maxBytes: 20 * 1024 * 1024,
    maxPages: 50,
    maxCharacters: 150_000,
    minCharacters: 500,
  },
  analysisRateLimitPerHour: Number(
    process.env.ANALYSIS_RATE_LIMIT_PER_HOUR ?? 5,
  ),
  datasetVersion: "yc-2022-2026-ytd-v1",
  modelVersion: "browser-fit-v1",
  // Public HTTPS URL for the versioned model ZIP in S3.
  modelArchiveUrl: "https://s3bot.rxlab.app/yc-models/16a3de34-d6e3-43a5-96ce-72f4439c4029-browser-fit-v1.zip",
} as const;

export const hasGatewayConfig = Boolean(process.env.AI_GATEWAY_API_KEY);
