import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ deleteChat: vi.fn(), listChatDocumentObjectKeys: vi.fn(), renameChat: vi.fn() }));
vi.mock("@/lib/storage/chat-documents", () => ({ deleteDocumentObjects: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { deleteChat, listChatDocumentObjectKeys } from "@/lib/db/repository";
import { deleteDocumentObjects } from "@/lib/storage/chat-documents";
import { DELETE } from "@/app/api/chats/[chatId]/route";

const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedDeleteChat = vi.mocked(deleteChat);
const mockedListDocumentKeys = vi.mocked(listChatDocumentObjectKeys);
const mockedDeleteDocumentObjects = vi.mocked(deleteDocumentObjects);

describe("DELETE /api/chats/:chatId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListDocumentKeys.mockResolvedValue([]);
  });

  it("requires authentication", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    const response = await DELETE(new Request("http://localhost/api/chats/chat-1", { method: "DELETE" }), { params: Promise.resolve({ chatId: "chat-1" }) });

    expect(response.status).toBe(401);
    expect(mockedDeleteChat).not.toHaveBeenCalled();
  });

  it("deletes only through the authenticated user's scope", async () => {
    mockedGetCurrentUser.mockResolvedValue({ id: "user-1", name: "Founder", email: "founder@example.com", roles: [] });
    mockedDeleteChat.mockResolvedValue({ id: "chat-1" });

    const response = await DELETE(new Request("http://localhost/api/chats/chat-1", { method: "DELETE" }), { params: Promise.resolve({ chatId: "chat-1" }) });

    expect(response.status).toBe(204);
    expect(mockedDeleteChat).toHaveBeenCalledWith("user-1", "chat-1");
  });

  it("does not reveal a conversation outside the user's scope", async () => {
    mockedGetCurrentUser.mockResolvedValue({ id: "user-1", name: "Founder", email: "founder@example.com", roles: [] });
    mockedDeleteChat.mockResolvedValue(null);

    const response = await DELETE(new Request("http://localhost/api/chats/other-chat", { method: "DELETE" }), { params: Promise.resolve({ chatId: "other-chat" }) });

    expect(response.status).toBe(404);
  });

  it("removes retained PDF objects before deleting the conversation", async () => {
    mockedGetCurrentUser.mockResolvedValue({ id: "user-1", name: "Founder", email: "founder@example.com", roles: [] });
    mockedListDocumentKeys.mockResolvedValue([{ objectKey: "chat-documents/source.pdf", extractedObjectKey: "chat-documents/source.json" }]);
    mockedDeleteChat.mockResolvedValue({ id: "chat-1" });

    const response = await DELETE(new Request("http://localhost/api/chats/chat-1", { method: "DELETE" }), { params: Promise.resolve({ chatId: "chat-1" }) });

    expect(response.status).toBe(204);
    expect(mockedDeleteDocumentObjects).toHaveBeenCalledWith(["chat-documents/source.pdf", "chat-documents/source.json"]);
    expect(mockedDeleteDocumentObjects.mock.invocationCallOrder[0]).toBeLessThan(mockedDeleteChat.mock.invocationCallOrder[0]);
  });
});
