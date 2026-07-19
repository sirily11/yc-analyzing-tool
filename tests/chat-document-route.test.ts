import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({
  createChatDocument: vi.fn(),
  deleteChatDocumentRecord: vi.fn(),
  getChat: vi.fn(),
  getChatDocument: vi.fn(),
  markChatDocumentReady: vi.fn(),
}));
vi.mock("@/lib/storage/chat-documents", () => ({
  createDocumentUploadUrls: vi.fn(),
  deleteDocumentObjects: vi.fn(),
  documentObjectKeys: vi.fn(),
  documentStorageConfig: vi.fn(),
  verifyRetainedDocument: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth";
import { createChatDocument, getChat, getChatDocument, markChatDocumentReady } from "@/lib/db/repository";
import { createDocumentUploadUrls, documentObjectKeys, documentStorageConfig, verifyRetainedDocument } from "@/lib/storage/chat-documents";
import { POST } from "@/app/api/chats/[chatId]/documents/route";
import { PATCH } from "@/app/api/chats/[chatId]/documents/[documentId]/route";

const metadata = { kind: "pdf" as const, name: "plan.pdf", size: 1_024, pages: 2, characters: 800, sha256: "a".repeat(64) };
const user = { id: "user-1", name: "Founder", email: "founder@example.com", roles: [] };
const config = { accessKeyId: "access", secretAccessKey: "secret", bucket: "shared", endpoint: "https://storage.example.com", region: "auto", prefix: "chat-documents" };
const mockedVerifyRetainedDocument = vi.mocked(verifyRetainedDocument);
const mockedMarkChatDocumentReady = vi.mocked(markChatDocumentReady);

describe("chat PDF upload routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(documentStorageConfig).mockReturnValue(config);
    vi.mocked(documentObjectKeys).mockReturnValue({ objectKey: "chat-documents/source.pdf", extractedObjectKey: "chat-documents/source.json" });
    vi.mocked(createDocumentUploadUrls).mockResolvedValue({ pdfUploadUrl: "https://upload.example.com/pdf", extractedUploadUrl: "https://upload.example.com/json" });
  });

  it("allocates signed uploads only inside the authenticated chat", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(getChat).mockResolvedValue({ id: "chat-1", userId: user.id, title: "Plan", createdAt: new Date(), updatedAt: new Date() });

    const response = await POST(new Request("http://localhost/api/chats/chat-1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata }),
    }), { params: Promise.resolve({ chatId: "chat-1" }) });
    const body = await response.json() as { id: string };

    expect(response.status).toBe(201);
    expect(documentObjectKeys).toHaveBeenCalledWith("chat-documents", user.id, "chat-1", body.id);
    expect(createChatDocument).toHaveBeenCalledWith(expect.objectContaining({ id: body.id, userId: user.id, chatId: "chat-1", metadata }));
  });

  it("does not allocate storage for another user's chat", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(getChat).mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/chats/other-chat/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata }),
    }), { params: Promise.resolve({ chatId: "other-chat" }) });

    expect(response.status).toBe(404);
    expect(createDocumentUploadUrls).not.toHaveBeenCalled();
  });

  it("verifies both stored objects before marking a PDF ready", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    const document = { id: "document-1", userId: user.id, chatId: "chat-1", metadata, objectKey: "chat-documents/source.pdf", extractedObjectKey: "chat-documents/source.json", status: "uploading" as const, createdAt: new Date(), readyAt: null };
    vi.mocked(getChatDocument).mockResolvedValue(document);
    mockedVerifyRetainedDocument.mockResolvedValue({ metadata, pages: [{ page: 1, text: "a" }, { page: 2, text: "b" }], text: "x".repeat(800) });
    mockedMarkChatDocumentReady.mockResolvedValue({ id: document.id });

    const response = await PATCH(new Request("http://localhost/api/chats/chat-1/documents/document-1", { method: "PATCH" }), { params: Promise.resolve({ chatId: "chat-1", documentId: "document-1" }) });

    expect(response.status).toBe(200);
    expect(verifyRetainedDocument).toHaveBeenCalledWith(document);
    expect(markChatDocumentReady).toHaveBeenCalledWith(user.id, "chat-1", document.id);
    expect(mockedVerifyRetainedDocument.mock.invocationCallOrder[0]).toBeLessThan(mockedMarkChatDocumentReady.mock.invocationCallOrder[0]);
  });
});
