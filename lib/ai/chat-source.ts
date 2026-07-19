import type { UIMessage } from "ai";
import { z } from "zod";
import { sourceFileMetadataSchema, type SourceFileMetadata } from "@/lib/types/analysis";

export const DEFAULT_PDF_REPORT_REQUEST = "Prepare a new YC Fit Score report from this pitch deck. Ask for my confirmation before analyzing it.";

export const pdfAttachmentSchema = z.object({
  documentId: z.string().uuid(),
  metadata: sourceFileMetadataSchema.extend({ kind: z.literal("pdf").optional() }),
});

export type PdfAttachment = { documentId: string; metadata: SourceFileMetadata };

export const chatDataSchemas = { pdfAttachment: pdfAttachmentSchema };

const legacyUploadNotice = /^I uploaded (.+?)\.\s+Document ID: ([0-9a-f-]+)\.\s+Source metadata: (\{.*\})\.\s+([\s\S]+)$/i;

function parseLegacyUploadNotice(text: string): { attachment: PdfAttachment; request: string } | null {
  const match = legacyUploadNotice.exec(text.trim());
  if (!match) return null;

  try {
    const parsed = pdfAttachmentSchema.safeParse({ documentId: match[2], metadata: JSON.parse(match[3]) });
    if (!parsed.success) return null;
    return { attachment: parsed.data, request: DEFAULT_PDF_REPORT_REQUEST };
  } catch {
    return null;
  }
}

export function createPdfUploadMessageParts(attachment: PdfAttachment, request: string) {
  return [
    { type: "data-pdfAttachment" as const, data: attachment },
    { type: "text" as const, text: request.trim() || DEFAULT_PDF_REPORT_REQUEST },
  ];
}

export function getPdfAttachment(message: Pick<UIMessage, "parts">): PdfAttachment | null {
  for (const part of message.parts) {
    if (part.type === "data-pdfAttachment" && "data" in part) {
      const parsed = pdfAttachmentSchema.safeParse(part.data);
      if (parsed.success) return parsed.data;
    }
  }

  for (const part of message.parts) {
    if (part.type === "text") {
      const parsed = parseLegacyUploadNotice(part.text);
      if (parsed) return parsed.attachment;
    }
  }
  return null;
}

export function getVisibleUserText(message: Pick<UIMessage, "parts">) {
  const textParts = message.parts.filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text");
  const legacy = textParts.map((part) => parseLegacyUploadNotice(part.text)).find(Boolean);
  if (legacy) return legacy.request;
  return textParts.map((part) => part.text.trim()).filter(Boolean).join("\n\n");
}

export function latestMessageRequestsPdfAnalysis(messages: UIMessage[]) {
  const latest = messages.at(-1);
  return latest?.role === "user" && getPdfAttachment(latest) !== null;
}

/** Whether the workflow started by a submitted PDF has reached a terminal tool state. */
export function submittedPdfWorkflowIsTerminal(messages: UIMessage[], documentId: string) {
  const submittedIndex = messages.findLastIndex((message) => getPdfAttachment(message)?.documentId === documentId);
  if (submittedIndex < 0) return false;
  return messages.slice(submittedIndex + 1).some((message) => message.parts.some((part) => {
    if (!("state" in part)) return false;
    if (part.type === "tool-publishReport" && part.state === "output-available") return true;
    if (part.type === "tool-confirm" && (
      part.state === "output-denied"
      || part.state === "output-error"
      || ("approval" in part && part.approval?.approved === false)
    )) return true;
    return ["tool-analyzeApplication", "tool-runLocalFitPrediction", "tool-publishReport"].includes(part.type)
      && part.state === "output-error";
  }));
}

/** Check for an approved, not-yet-consumed confirmation after the latest user turn. */
export function hasApprovedConfirmation(messages: UIMessage[]) {
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  if (latestUserIndex < 0) return false;

  let approved = false;
  for (const message of messages.slice(latestUserIndex + 1)) {
    for (const part of message.parts) {
      if (part.type === "tool-confirm" && "approval" in part) approved = part.approval?.approved === true;
      if (part.type === "tool-analyzeApplication" && "state" in part && part.state !== "input-streaming") approved = false;
    }
  }
  return approved;
}

export function pdfAttachmentToModelPart(part: { type: string; data?: unknown }) {
  if (part.type !== "data-pdfAttachment") return undefined;
  const parsed = pdfAttachmentSchema.safeParse(part.data);
  if (!parsed.success) return undefined;
  return {
    type: "text" as const,
    text: `Uploaded PDF reference for the report flow (use these exact values for analyzeApplication after confirmation):\nDocument ID: ${parsed.data.documentId}\nSource metadata: ${JSON.stringify(parsed.data.metadata)}`,
  };
}

/** Collect the founder's typed context since the latest completed report. */
export function collectChatAnalysisText(messages: UIMessage[]) {
  let startIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const published = messages[index]?.parts.some((part) => part.type === "tool-publishReport" && "state" in part && part.state === "output-available");
    if (published) {
      startIndex = index + 1;
      break;
    }
  }

  const text = messages
    .slice(startIndex)
    .filter((message) => message.role === "user")
    .filter((message) => getPdfAttachment(message) === null)
    .flatMap((message) => message.parts)
    .filter((part): part is Extract<(typeof messages)[number]["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text || null;
}
