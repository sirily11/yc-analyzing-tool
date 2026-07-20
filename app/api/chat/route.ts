import { createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages, stepCountIs, streamText, type UIMessage, validateUIMessages } from "ai";
import { appConfig, hasGatewayConfig } from "@/config";
import { getCurrentUser } from "@/lib/auth";
import { generateChatTitle } from "@/lib/ai/chat-title";
import { chatToolErrorMessage } from "@/lib/ai/chat-error";
import { persistChatCompletion } from "@/lib/ai/chat-persistence";
import { createAnalysisTools } from "@/lib/ai/tools";
import { approvedConfirmationActions, chatDataSchemas, collectChatAnalysisText, latestMessageRequestsPdfAnalysis, pdfAttachmentToModelPart } from "@/lib/ai/chat-source";
import { DEFAULT_CHAT_TITLE } from "@/lib/chat-title";
import { getChat, renameChatIfTitleMatches, replaceMessages } from "@/lib/db/repository";

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasGatewayConfig) return Response.json({ error: "AI Gateway is not configured" }, { status: 503 });
  const body = await request.json() as { id: string; messages: UIMessage[] };
  const chat = await getChat(user.id, body.id);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
  const chatText = collectChatAnalysisText(body.messages);
  const tools = createAnalysisTools({ userId: user.id, chatId: chat.id, chatText, approvedActions: approvedConfirmationActions(body.messages), requestSignal: request.signal });
  const messages = await validateUIMessages({ messages: body.messages, dataSchemas: chatDataSchemas, tools: tools as unknown as Parameters<typeof validateUIMessages>[0]["tools"] });
  const modelMessages = await convertToModelMessages(messages, { tools, convertDataPart: pdfAttachmentToModelPart });
  const requiresPdfApproval = latestMessageRequestsPdfAnalysis(messages);
  const result = streamText({
    model: appConfig.chatModel,
    abortSignal: request.signal,
    temperature: appConfig.temperature,
    stopWhen: stepCountIs(appConfig.maxToolSteps),
    system: `You are Application Signal, a concise startup application analyst. Render normal answers in clear GitHub-flavored Markdown. Never claim to predict YC acceptance probability. The only score is a YC Fit Score.

When you need information from the user before continuing, call askQuestion instead of asking in prose. Do not end a normal prose response with a question that requires an answer. Use single-select for one choice, multiple-select for several choices, or free-form for an open response. Single-select automatically includes a custom free-form answer in the UI.

Tool result cards are the presentation surface. After a tool with a rich result UI succeeds, do not restate, summarize, tabulate, or list any content already visible in that card. Do not repeat company names, profile fields, scores, comparison insights, citations, map details, or report links in prose. Treat the rendered tool result as terminal for that answer and emit no follow-up text unless the user explicitly asks for information that the card does not show.

When a user uploads a PDF, call confirm with action "application-analysis" and a short title and message explaining that approval will analyze the pitch deck, run the local fit score, research five public comparable companies with Firecrawl, and draft the report. The founder's PDF or chat brief is never sent to Firecrawl. When a user explicitly asks to score, assess, or generate a report from a startup description they typed in chat, use the same application-analysis confirmation flow. A PDF is not required for chat-based analysis. Always use confirm instead of asking the user for approval in prose. Never omit confirm's action. Do not call the application analysis tools for ordinary brainstorming or follow-up questions unless the user asks for a new score or report.

Only after application-analysis confirm returns confirmed, call analyzeApplication with the exact supplied PDF reference or the chat source. Then call runLocalFitPrediction using analyzeApplication's exact reportId and profile. After the browser tool returns, call publishReport with the exact prior profile and prediction. Do not change model scores or versions. The publishReport card owns the report progress link, so do not repeat it in prose. Every new or materially revised score requires a new confirmed confirm tool call.

For questions about public YC companies from 2022–2026, use searchYcCompanies to resolve names, themes, or filters. Use getYcCompanyData for factual lookups that do not need a saved analysis. If more than ten companies match an analysis request, use askQuestion to narrow the set. Public-company lookup and company research never require a PDF; they use exact YC company IDs and public sources.

When the user asks to analyze, compare, research, report on, or build a semantic map for one to ten YC companies, call confirm with the required action "company-research" and explain that approval uses Firecrawl public-web research and creates a private saved report. Never omit or substitute that action. Only after that confirmation returns confirmed, call researchYcCompanies with exact company IDs and the user's requested focus. Then call runCompanyClusterMap with its exact reportId. After the browser returns the map, call publishCompanyResearchReport with the exact reportId and map. Never invent or alter sources, company IDs, coordinates, model versions, or dataset versions. Existing-company research never receives a YC Fit Score or acceptance probability.`,
    messages: modelMessages,
    tools,
    toolChoice: requiresPdfApproval ? { type: "tool", toolName: "confirm" } : "auto",
  });
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.merge(result.toUIMessageStream({
        originalMessages: messages,
        onFinish: async ({ messages: finished, isAborted, finishReason }) => {
          const persisted = await persistChatCompletion(
            () => replaceMessages(user.id, chat.id, finished),
            { onFailure: (cause) => console.error("Failed to persist completed chat stream", cause) },
          );
          if (!persisted) return;
          const hasCompletedExchange = finished.some((message) => message.role === "user")
            && finished.some((message) => message.role === "assistant" && message.parts.length > 0);
          if (!isAborted && finishReason !== "error" && chat.title === DEFAULT_CHAT_TITLE && hasCompletedExchange) {
            try {
              const title = await generateChatTitle(finished);
              const renamed = title
                ? await renameChatIfTitleMatches(user.id, chat.id, DEFAULT_CHAT_TITLE, title)
                : null;
              if (renamed) writer.write({ type: "data-chatTitle", data: { title: renamed.title }, transient: true });
            } catch (cause) {
              console.error("Failed to generate the initial chat title", cause);
            }
          }
        },
        onError: chatToolErrorMessage,
      }));
    },
  });
  return createUIMessageStreamResponse({ stream });
}
