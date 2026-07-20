import "server-only";
import type { UIMessage } from "ai";

type ToolLogLevel = "info" | "warn" | "error";
type ToolLogFields = Record<string, unknown>;

type ToolCallLike = {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
};

/**
 * Structured chat-tool logging. Keep fields limited to identifiers, action
 * names, counts, schema keys, and status codes. Never pass prompts, document
 * contents, research text, source URLs, or credentials.
 */
export function chatToolLog(level: ToolLogLevel, event: string, fields: ToolLogFields = {}) {
  if (process.env.NODE_ENV === "test") return;
  const payload = {
    event,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  };
  if (level === "error") console.error("[chat-tools]", payload);
  else if (level === "warn") console.warn("[chat-tools]", payload);
  else console.info("[chat-tools]", payload);
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function summarizeToolCall(toolCall: ToolCallLike) {
  const input = objectValue(toolCall.input);
  const toolName = typeof toolCall.toolName === "string" ? toolCall.toolName : "unknown";
  const summary: Record<string, unknown> = {
    toolName,
    toolCallId: toolCall.toolCallId,
    inputKeys: input ? Object.keys(input).sort() : [],
  };

  if (toolName === "confirm") {
    summary.action = typeof input?.action === "string" ? input.action : "missing";
  } else if (["researchYcCompanies", "getYcCompanyData"].includes(toolName)) {
    summary.companyIds = Array.isArray(input?.companyIds) ? input.companyIds.filter((id) => typeof id === "number") : [];
    if (typeof input?.request === "string") summary.requestLength = input.request.length;
  } else if (["runCompanyClusterMap", "publishCompanyResearchReport", "publishReport"].includes(toolName)) {
    summary.reportId = typeof input?.reportId === "string" ? input.reportId : undefined;
  } else if (toolName === "analyzeApplication") {
    summary.sourceKind = input?.sourceKind === "chat" ? "chat" : "pdf";
    summary.hasDocumentId = typeof input?.documentId === "string";
    summary.hasParentReportId = typeof input?.parentReportId === "string";
  }

  return summary;
}

export function summarizeToolOutput(output: unknown) {
  const value = objectValue(output);
  if (!value) return { outputType: output === null ? "null" : typeof output };
  const error = objectValue(value.error);
  return {
    outputKeys: Object.keys(value).sort(),
    toolOutcome: value.ok === false ? "failed" : value.ok === true ? "completed" : undefined,
    errorCode: typeof error?.code === "string" ? error.code : undefined,
    scrapeErrorCount: Array.isArray(error?.scrapeErrors) ? error.scrapeErrors.length : undefined,
    reportId: typeof value.reportId === "string" ? value.reportId : undefined,
    companyCount: Array.isArray(value.companies) ? value.companies.length : undefined,
    sourceCount: Array.isArray(value.sources) ? value.sources.length : undefined,
    warningCount: Array.isArray(value.warnings) ? value.warnings.length : undefined,
  };
}

function errorChain(cause: unknown) {
  const values: Array<{ name?: string; message?: string }> = [];
  let current = cause;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current === "string") {
      values.push({ message: current });
      break;
    }
    if (current instanceof Error) {
      values.push({ name: current.name, message: current.message });
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const value = current as { name?: unknown; message?: unknown; cause?: unknown };
      values.push({
        name: typeof value.name === "string" ? value.name : undefined,
        message: typeof value.message === "string" ? value.message : undefined,
      });
      current = value.cause;
      continue;
    }
    break;
  }
  return values;
}

function conciseMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 300) : undefined;
}

function providerErrorFields(value: unknown) {
  const record = objectValue(value);
  if (!record) return {};
  const error = objectValue(record.error);
  return {
    type: typeof error?.type === "string" ? error.type : undefined,
    code: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : undefined,
    message: conciseMessage(error?.message),
    generationId: typeof record.generationId === "string" ? record.generationId : undefined,
  };
}

function parsedProviderBody(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Extract provider diagnostics without logging request bodies, prompts, source
 * URLs, response bodies, or credentials.
 */
export function summarizeProviderError(cause: unknown) {
  const statusCodes = new Set<number>();
  const retryable = new Set<boolean>();
  const types = new Set<string>();
  const codes = new Set<string | number>();
  const messages = new Set<string>();
  const generationIds = new Set<string>();
  const requestIds = new Set<string>();
  const endpoints = new Set<string>();
  let responseBodyCharacters = 0;
  let current = cause;

  for (let depth = 0; depth < 6 && current; depth += 1) {
    const value = objectValue(current);
    if (!value) break;
    if (typeof value.statusCode === "number") statusCodes.add(value.statusCode);
    if (typeof value.isRetryable === "boolean") retryable.add(value.isRetryable);
    if (typeof value.type === "string") types.add(value.type);
    if (typeof value.generationId === "string") generationIds.add(value.generationId);
    if (typeof value.url === "string") {
      try {
        const url = new URL(value.url);
        endpoints.add(`${url.hostname}${url.pathname}`);
      } catch {
        // Ignore malformed or non-HTTP endpoint values.
      }
    }

    const headers = objectValue(value.responseHeaders);
    if (headers) {
      const allowlisted = new Set(["x-request-id", "x-vercel-id", "x-ai-gateway-request-id", "ai-gateway-request-id", "x-openai-request-id", "cf-ray"]);
      for (const [name, headerValue] of Object.entries(headers)) {
        if (allowlisted.has(name.toLowerCase()) && typeof headerValue === "string") requestIds.add(`${name.toLowerCase()}:${headerValue.slice(0, 160)}`);
      }
    }

    const responseBody = typeof value.responseBody === "string" ? value.responseBody : undefined;
    if (responseBody) responseBodyCharacters = Math.max(responseBodyCharacters, responseBody.length);
    for (const details of [providerErrorFields(value.data), providerErrorFields(parsedProviderBody(responseBody))]) {
      if (details.type) types.add(details.type);
      if (details.code !== undefined) codes.add(details.code);
      if (details.message) messages.add(details.message);
      if (details.generationId) generationIds.add(details.generationId);
    }

    if (typeof value.name === "string" && value.name.startsWith("Gateway")) {
      const message = conciseMessage(value.message);
      if (message) messages.add(message);
    }
    current = value.cause;
  }

  return {
    providerStatusCodes: [...statusCodes],
    providerRetryable: [...retryable],
    providerErrorTypes: [...types],
    providerErrorCodes: [...codes],
    providerMessages: [...messages],
    providerGenerationIds: [...generationIds],
    providerRequestIds: [...requestIds],
    providerEndpoints: [...endpoints],
    responseBodyCharacters: responseBodyCharacters || undefined,
  };
}

export function summarizeToolError(cause: unknown) {
  const chain = errorChain(cause);
  const messages = chain.flatMap(({ message }) => message ? [message] : []);
  const stableCode = messages.flatMap((message) => message.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?::\d{3})?\b/g) ?? [])[0];
  const names = [...new Set(chain.flatMap(({ name }) => name && name !== "Error" ? [name] : []))];
  let errorCode = stableCode;
  if (!errorCode && names.includes("TimeoutError")) errorCode = "TIMEOUT";
  if (!errorCode && names.includes("AbortError")) errorCode = "ABORTED";
  if (!errorCode && names.includes("TypeError")) errorCode = "TYPE_ERROR";
  if (!errorCode && names.includes("ZodError")) errorCode = "VALIDATION_ERROR";
  return { errorCode: errorCode ?? "UNEXPECTED_ERROR", errorNames: names };
}

export function summarizePersistedToolStates(messages: UIMessage[]) {
  return messages.flatMap((message) => message.parts.flatMap((part) => {
    if (!part.type.startsWith("tool-")) return [];
    const value = part as typeof part & {
      toolCallId?: string;
      state?: string;
      input?: unknown;
      approval?: { approved?: boolean };
    };
    const input = objectValue(value.input);
    return [{
      toolName: part.type.slice("tool-".length),
      toolCallId: value.toolCallId,
      state: value.state,
      action: part.type === "tool-confirm" ? (typeof input?.action === "string" ? input.action : "missing") : undefined,
      approved: part.type === "tool-confirm" ? value.approval?.approved ?? null : undefined,
    }];
  })).slice(-12);
}
