"use client";

import { appConfig } from "@/config";
import type { ExtractedPdf } from "@/lib/types/analysis";

export async function extractPdf(file: File): Promise<ExtractedPdf> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Choose a PDF file.");
  if (file.size > appConfig.pdf.maxBytes) throw new Error("The PDF is larger than 20 MB.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buffer.slice(0) });
  let pdf;
  try { pdf = await loadingTask.promise; } catch { throw new Error("The PDF is encrypted, damaged, or cannot be opened."); }
  if (pdf.numPages > appConfig.pdf.maxPages) throw new Error(`The PDF has ${pdf.numPages} pages; the limit is ${appConfig.pdf.maxPages}.`);
  const pages: Array<{ page: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    pages.push({ page: pageNumber, text });
  }
  const text = pages.map((page) => page.text).join("\n\n").slice(0, appConfig.pdf.maxCharacters);
  if (text.length < appConfig.pdf.minCharacters) throw new Error("This looks like an image-only or nearly empty PDF. Version 1 supports selectable-text PDFs only.");
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { metadata: { kind: "pdf", name: file.name, size: file.size, pages: pdf.numPages, characters: text.length, sha256 }, pages, text };
}
