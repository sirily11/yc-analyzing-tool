export type MessagePartLike = { type: string; [key: string]: unknown };

export function stripEphemeralParts<T extends MessagePartLike>(parts: T[]): Array<T | { type: "data-document-status"; data: { retained: false } }> {
  return parts.map((part) => part.type === "data-document-text" ? { type: "data-document-status", data: { retained: false } } : part);
}
