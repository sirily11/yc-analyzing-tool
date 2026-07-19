export const DEFAULT_CHAT_TITLE = "New application analysis";
export const MAX_CHAT_TITLE_LENGTH = 80;

export function normalizeChatTitle(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeGeneratedChatTitle(value: string) {
  const withoutFormatting = normalizeChatTitle(value)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'`*]+|["'`*]+$/g, "");

  return normalizeChatTitle(withoutFormatting).slice(0, MAX_CHAT_TITLE_LENGTH).trim();
}
