import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadRetainedPdf } from "@/lib/pdf/storage-client";
import type { ExtractedPdf } from "@/lib/types/analysis";

const document: ExtractedPdf = {
  metadata: { kind: "pdf", name: "plan.pdf", size: 3, pages: 1, characters: 800, sha256: "a".repeat(64) },
  pages: [{ page: 1, text: "x".repeat(800) }],
  text: "x".repeat(800),
};

describe("browser PDF retention upload", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads raw bytes through signed URLs without CORS request headers before finalizing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "document-1", pdfUploadUrl: "https://storage.example.com/source", extractedUploadUrl: "https://storage.example.com/extracted" }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ id: "document-1", metadata: document.metadata }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new Blob(["pdf"], { type: "application/pdf" }) as File;

    const retained = await uploadRetainedPdf("chat-1", file, document);

    expect(retained).toEqual({ id: "document-1", metadata: document.metadata });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://storage.example.com/source", { method: "PUT", body: expect.any(ArrayBuffer) });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://storage.example.com/extracted", { method: "PUT", body: expect.any(ArrayBuffer) });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/chats/chat-1/documents/document-1", { method: "PATCH" });
  });

  it("cleans up an allocation when either signed upload fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "document-1", pdfUploadUrl: "https://storage.example.com/source", extractedUploadUrl: "https://storage.example.com/extracted" }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadRetainedPdf("chat-1", new Blob(["pdf"], { type: "application/pdf" }) as File, document)).rejects.toThrow("S3 rejected");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/chats/chat-1/documents/document-1", { method: "DELETE" });
  });
});
