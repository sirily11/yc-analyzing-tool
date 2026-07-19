import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { documentObjectKeys, documentStorageConfig } from "@/lib/storage/chat-documents";

describe("retained chat PDF storage", () => {
  it("reuses the configured S3 bucket with a separate default prefix", () => {
    const config = documentStorageConfig({
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_BUCKET: "application-signal",
      S3_ENDPOINT: "https://storage.example.com/",
      S3_REGION: "auto",
    });

    expect(config.bucket).toBe("application-signal");
    expect(config.prefix).toBe("chat-documents");
    expect(config.endpoint).toBe("https://storage.example.com");
  });

  it("builds opaque owner and chat scoped object keys", () => {
    const keys = documentObjectKeys("private/pdfs", "founder@example.com", "chat-123", "document-456");

    expect(keys.objectKey).toMatch(/^private\/pdfs\/[a-f0-9]{24}\/[a-f0-9]{24}\/document-456\.pdf$/);
    expect(keys.extractedObjectKey).toMatch(/^private\/pdfs\/[a-f0-9]{24}\/[a-f0-9]{24}\/document-456\.extracted\.json$/);
    expect(JSON.stringify(keys)).not.toContain("founder@example.com");
    expect(JSON.stringify(keys)).not.toContain("chat-123");
  });

  it("requires the existing S3 connection settings", () => {
    expect(() => documentStorageConfig({ S3_BUCKET: "application-signal" })).toThrow("S3_ACCESS_KEY_ID");
  });
});
