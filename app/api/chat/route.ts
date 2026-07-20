import { randomUUID } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages, hasToolCall, streamText, type UIMessage, validateUIMessages } from "ai";
import { appConfig, hasGatewayConfig, modelTemperature } from "@/config";
import { getCurrentUser } from "@/lib/auth";
import { generateChatTitle } from "@/lib/ai/chat-title";
import { chatToolErrorMessage } from "@/lib/ai/chat-error";
import { chatToolLog, summarizePersistedToolStates, summarizeToolCall, summarizeToolError, summarizeToolOutput } from "@/lib/ai/tool-log";
import { persistChatCompletion } from "@/lib/ai/chat-persistence";
import { createAnalysisTools } from "@/lib/ai/tools";
import { approvedConfirmationActions, chatDataSchemas, collectChatAnalysisText, latestMessageRequestsPdfAnalysis, pdfAttachmentToModelPart } from "@/lib/ai/chat-source";
import { DEFAULT_CHAT_TITLE } from "@/lib/chat-title";
import { getChat, renameChatIfTitleMatches, replaceMessages } from "@/lib/db/repository";
import { billingConfig, reserveWithMargin } from "@/lib/billing/config";
import { InsufficientCreditsError, insufficientCreditsResponse } from "@/lib/billing/errors";
import { closeReservation, reserveCredits } from "@/lib/billing/repository";
import { gatewayProviderOptions, normalizeLanguageUsage, recordAiUsage } from "@/lib/billing/usage";

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasGatewayConfig) return Response.json({ error: "AI Gateway is not configured" }, { status: 503 });
  const body = await request.json() as { id: string; messages: UIMessage[] };
  const chat = await getChat(user.id, body.id);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
  const requestId = randomUUID();
  let reservation;
  try {
    reservation = await reserveCredits({
      userId: user.id,
      operationKey: `chat:${user.id}:${requestId}`,
      feature: "Chat",
      points: reserveWithMargin(billingConfig.chatReservationPoints),
      scopeId: chat.id,
    });
  } catch (cause) {
    if (cause instanceof InsufficientCreditsError) return insufficientCreditsResponse(cause);
    throw cause;
  }
  const metering = { userId: user.id, reservationId: reservation?.id ?? null, feature: "Chat", operationId: requestId };
  const chatText = collectChatAnalysisText(body.messages);
  const approvedActions = approvedConfirmationActions(body.messages);
  chatToolLog("info", "request.started", {
    requestId,
    chatId: chat.id,
    messageCount: body.messages.length,
    approvedActions: [...approvedActions],
    toolStates: summarizePersistedToolStates(body.messages),
  });
  const tools = createAnalysisTools({ userId: user.id, chatId: chat.id, chatText, approvedActions, requestId, requestSignal: request.signal, reservationId: reservation?.id });
  const messages = await validateUIMessages({ messages: body.messages, dataSchemas: chatDataSchemas, tools: tools as unknown as Parameters<typeof validateUIMessages>[0]["tools"] });
  const titleTask = chat.title === DEFAULT_CHAT_TITLE
    ? generateChatTitle(messages, { ...metering, feature: "Chat title" })
      .then((title) => title ? renameChatIfTitleMatches(user.id, chat.id, DEFAULT_CHAT_TITLE, title) : null)
      .catch((cause) => {
        console.error("Failed to generate the initial chat title", cause);
        return null;
      })
    : Promise.resolve(null);
  const modelMessages = await convertToModelMessages(messages, { tools, convertDataPart: pdfAttachmentToModelPart });
  const requiresPdfApproval = latestMessageRequestsPdfAnalysis(messages);
  const result = streamText({
    model: appConfig.chatModel,
    abortSignal: request.signal,
    temperature: modelTemperature(appConfig.chatModel, appConfig.temperature),
    maxOutputTokens: 4_096,
    stopWhen: hasToolCall("stop"),
    system: `You are Application Signal, a concise startup application analyst. Render normal answers in clear GitHub-flavored Markdown. Never claim to predict YC acceptance probability. The only score is a YC Fit Score.

You must call a tool on every step. Continue until the user's request is complete, then call stop as the only tool in the final step. Put the complete user-visible Markdown response in stop.answer. When a rich tool result card already presents the complete answer, call stop with an empty answer. Never finish by emitting ordinary assistant text, and never call stop before required tool work is complete.

When you need information from the user before continuing, call askQuestion instead of asking in prose. Do not end a normal prose response with a question that requires an answer. Use single-select for one choice, multiple-select for several choices, or free-form for an open response. Single-select automatically includes a custom free-form answer in the UI.

Tool result cards are the presentation surface. After a tool with a rich result UI succeeds, do not restate, summarize, tabulate, or list any content already visible in that card. Do not repeat company names, profile fields, scores, comparison insights, citations, map details, or report links in stop.answer. Treat the rendered tool result as terminal for that answer and call stop with an empty answer unless the user explicitly asks for information that the card does not show.

When a user uploads a PDF, call confirm with action "application-analysis" and a short title and message explaining that approval will analyze the pitch deck, run the local fit score, research five public comparable companies with Firecrawl, and draft the report. The founder's PDF or chat brief is never sent to Firecrawl. When a user explicitly asks to score, assess, or generate a report from a startup description they typed in chat, use the same application-analysis confirmation flow. A PDF is not required for chat-based analysis. Always use confirm instead of asking the user for approval in prose. Never omit confirm's action. Do not call the application analysis tools for ordinary brainstorming or follow-up questions unless the user asks for a new score or report.

Only after application-analysis confirm returns confirmed, call analyzeApplication with the exact supplied PDF reference or the chat source. Then call runLocalFitPrediction using analyzeApplication's exact reportId and profile. After the browser tool returns, call publishReport with the exact prior profile and prediction. Do not change model scores or versions. The publishReport card owns the report progress link, so do not repeat it in stop.answer. Every new or materially revised score requires a new confirmed confirm tool call.

For questions about public YC companies from 2020 through the current year, use searchYcCompanies for natural-language semantic retrieval and optional exact filters. Use getYcCompanyData for factual lookups that do not need a saved analysis. If more than ten companies match an analysis request, use askQuestion to narrow the set. Public-company lookup and company research never require a PDF; they use exact YC company IDs and public sources.

When the user asks to analyze, compare, research, report on, or build a semantic map for one to ten YC companies, call confirm with the required action "company-research" and explain that approval uses Firecrawl public-web research and creates a private saved report. Never omit or substitute that action. Only after that confirmation returns confirmed, call researchYcCompanies with exact company IDs and the user's requested focus. This tool enqueues a durable Vercel Workflow and returns a private progress-page link immediately; after it succeeds, call stop with an empty answer because its result card owns that link. If researchYcCompanies returns ok false, clearly report its error message and each scrapeErrors URL and message to the user. Do not retry research or request another confirmation after a failed result. Never invent or alter sources, company IDs, coordinates, model versions, or dataset versions. Existing-company research never receives a YC Fit Score or acceptance probability.`,
    messages: modelMessages,
    tools,
    toolChoice: requiresPdfApproval ? { type: "tool", toolName: "confirm" } : "required",
    providerOptions: gatewayProviderOptions(metering),
    onStepFinish: async ({ finishReason, toolCalls, toolResults, response, usage, providerMetadata }) => {
      chatToolLog("info", "step.finished", {
        requestId,
        chatId: chat.id,
        finishReason,
        toolCalls: toolCalls.map(summarizeToolCall),
        toolResultCount: toolResults.length,
      });
      // Metering must never abort the run: a rejection here tears down streamText
      // before onFinish, which is the only place completed messages are persisted.
      try {
        await recordAiUsage({
          context: metering,
          model: appConfig.chatModel,
          responseId: response.id,
          providerMetadata,
          usage: normalizeLanguageUsage(usage),
        });
      } catch (cause) {
        chatToolLog("error", "usage.metering.failed", { requestId, chatId: chat.id, ...summarizeToolError(cause) });
      }
    },
    experimental_onToolCallStart: ({ stepNumber, toolCall }) => {
      chatToolLog("info", "tool.execution.started", { requestId, chatId: chat.id, stepNumber, ...summarizeToolCall(toolCall) });
    },
    experimental_onToolCallFinish: ({ stepNumber, toolCall, durationMs, success, ...event }) => {
      chatToolLog(success ? "info" : "error", success ? "tool.execution.completed" : "tool.execution.failed", {
        requestId,
        chatId: chat.id,
        stepNumber,
        durationMs,
        ...summarizeToolCall(toolCall),
        ...(success ? summarizeToolOutput(event.output) : summarizeToolError(event.error)),
      });
    },
    onError: ({ error }) => {
      chatToolLog("error", "stream.failed", { requestId, chatId: chat.id, ...summarizeToolError(error) });
      if (reservation) void closeReservation({ reservationId: reservation.id, userId: user.id, success: false });
    },
  });
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.merge(result.toUIMessageStream({
        originalMessages: messages,
        // Without this the response message carries no id, and persisting it violates
        // the messages primary key. The SDK only supplies one when resuming an
        // existing assistant message.
        generateMessageId: () => randomUUID(),
        onFinish: async ({ messages: finished }) => {
          await titleTask;
          const persisted = await persistChatCompletion(
            () => replaceMessages(user.id, chat.id, finished),
            {
              onFailure: (cause) => chatToolLog("error", "chat.persist.failed", {
                requestId,
                chatId: chat.id,
                messageCount: finished.length,
                roles: finished.map((message) => message.role),
                ...summarizeToolError(cause),
                cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
              }),
            },
          );
          if (persisted) chatToolLog("info", "chat.persist.completed", { requestId, chatId: chat.id, messageCount: finished.length });
          if (reservation) await closeReservation({ reservationId: reservation.id, userId: user.id, success: true });
        },
        onError: chatToolErrorMessage,
      }));
      const renamed = await titleTask;
      if (renamed) writer.write({ type: "data-chatTitle", data: { title: renamed.title }, transient: true });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
