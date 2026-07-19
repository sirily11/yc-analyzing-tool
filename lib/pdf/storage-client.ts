"use client";

import type { ExtractedPdf, SourceFileMetadata } from "@/lib/types/analysis";

export type RetainedChatPdf = { id: string; metadata: SourceFileMetadata };

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

async function cleanupUpload(chatId: string, documentId: string) {
  await fetch(`/api/chats/${chatId}/documents/${documentId}`, { method: "DELETE" }).catch(() => undefined);
}

export async function uploadRetainedPdf(chatId: string, file: File, document: ExtractedPdf): Promise<RetainedChatPdf> {
  const allocation = await fetch(`/api/chats/${chatId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata: document.metadata }),
  });
  if (!allocation.ok) throw new Error(await responseError(allocation, "Could not prepare PDF storage."));

  const upload = await allocation.json() as { id: string; pdfUploadUrl: string; extractedUploadUrl: string };
  try {
    // R2 CORS policies commonly allow PUT without allowing request headers.
    // ArrayBuffer bodies keep fetch from adding Content-Type to the preflight.
    const [pdfBytes, extractedBytes] = await Promise.all([
      file.arrayBuffer(),
      new Blob([JSON.stringify(document)]).arrayBuffer(),
    ]);
    const [pdfResponse, extractedResponse] = await Promise.all([
      fetch(upload.pdfUploadUrl, { method: "PUT", body: pdfBytes }),
      fetch(upload.extractedUploadUrl, { method: "PUT", body: extractedBytes }),
    ]);
    if (!pdfResponse.ok || !extractedResponse.ok) throw new Error("S3 rejected the PDF upload.");

    const completion = await fetch(`/api/chats/${chatId}/documents/${upload.id}`, { method: "PATCH" });
    if (!completion.ok) throw new Error(await responseError(completion, "Could not verify the stored PDF."));
    const retained = await completion.json() as RetainedChatPdf;
    return retained;
  } catch (cause) {
    await cleanupUpload(chatId, upload.id);
    throw cause;
  }
}

export async function deleteRetainedPdf(chatId: string, documentId: string) {
  const response = await fetch(`/api/chats/${chatId}/documents/${documentId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(await responseError(response, "Could not delete the stored PDF."));
}
