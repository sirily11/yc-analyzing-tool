import "server-only";

import { createHash } from "node:crypto";
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { extractedPdfSchema, type ExtractedPdf, type SourceFileMetadata } from "@/lib/types/analysis";

export type DocumentStorageConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
  prefix: string;
};

export type StoredDocumentObject = {
  metadata: SourceFileMetadata;
  objectKey: string;
  extractedObjectKey: string;
};

type StorageEnvironment = Readonly<Record<string, string | undefined>>;

function requiredEnv(environment: StorageEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for retained chat PDFs.`);
  return value;
}

export function documentStorageConfig(environment: StorageEnvironment = process.env): DocumentStorageConfig {
  return {
    accessKeyId: requiredEnv(environment, "S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv(environment, "S3_SECRET_ACCESS_KEY"),
    bucket: requiredEnv(environment, "S3_BUCKET"),
    endpoint: requiredEnv(environment, "S3_ENDPOINT").replace(/\/+$/, ""),
    region: requiredEnv(environment, "S3_REGION"),
    prefix: environment.S3_DOCUMENT_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "chat-documents",
  };
}

export function documentObjectKeys(prefix: string, userId: string, chatId: string, documentId: string) {
  const ownerScope = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  const chatScope = createHash("sha256").update(chatId).digest("hex").slice(0, 24);
  const base = [prefix.replace(/^\/+|\/+$/g, ""), ownerScope, chatScope, documentId].filter(Boolean).join("/");
  return { objectKey: `${base}.pdf`, extractedObjectKey: `${base}.extracted.json` };
}

function createClient(config: DocumentStorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function createDocumentUploadUrls(keys: { objectKey: string; extractedObjectKey: string }, config = documentStorageConfig()) {
  const client = createClient(config);
  const [pdfUploadUrl, extractedUploadUrl] = await Promise.all([
    getSignedUrl(client, new PutObjectCommand({ Bucket: config.bucket, Key: keys.objectKey }), { expiresIn: 10 * 60 }),
    getSignedUrl(client, new PutObjectCommand({ Bucket: config.bucket, Key: keys.extractedObjectKey }), { expiresIn: 10 * 60 }),
  ]);
  return { pdfUploadUrl, extractedUploadUrl };
}

async function readObject(client: S3Client, bucket: string, key: string) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("DOCUMENT_OBJECT_EMPTY");
  return Uint8Array.from(await result.Body.transformToByteArray());
}

function metadataMatches(left: SourceFileMetadata, right: SourceFileMetadata) {
  return (left.kind ?? "pdf") === (right.kind ?? "pdf")
    && left.name === right.name
    && left.size === right.size
    && left.pages === right.pages
    && left.characters === right.characters
    && left.sha256 === right.sha256;
}

function parseExtractedDocument(bytes: Uint8Array, expected: SourceFileMetadata) {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("DOCUMENT_EXTRACTION_INVALID");
  }
  const parsed = extractedPdfSchema.safeParse(value);
  if (!parsed.success || !metadataMatches(parsed.data.metadata, expected)) throw new Error("DOCUMENT_EXTRACTION_INVALID");
  if (parsed.data.pages.length !== expected.pages || parsed.data.text.length !== expected.characters) throw new Error("DOCUMENT_EXTRACTION_INVALID");
  return parsed.data;
}

export async function verifyRetainedDocument(document: StoredDocumentObject, config = documentStorageConfig()): Promise<ExtractedPdf> {
  const client = createClient(config);
  const [pdf, extracted] = await Promise.all([
    readObject(client, config.bucket, document.objectKey),
    readObject(client, config.bucket, document.extractedObjectKey),
  ]);
  if (pdf.byteLength !== document.metadata.size) throw new Error("DOCUMENT_SIZE_MISMATCH");
  if (createHash("sha256").update(pdf).digest("hex") !== document.metadata.sha256) throw new Error("DOCUMENT_HASH_MISMATCH");
  return parseExtractedDocument(extracted, document.metadata);
}

export async function readRetainedDocument(document: StoredDocumentObject, config = documentStorageConfig()): Promise<ExtractedPdf> {
  const client = createClient(config);
  const extracted = await readObject(client, config.bucket, document.extractedObjectKey);
  return parseExtractedDocument(extracted, document.metadata);
}

export async function deleteDocumentObjects(keys: string[], config = documentStorageConfig()) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!uniqueKeys.length) return;
  const client = createClient(config);
  for (let offset = 0; offset < uniqueKeys.length; offset += 1_000) {
    const result = await client.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: uniqueKeys.slice(offset, offset + 1_000).map((Key) => ({ Key })), Quiet: true },
    }));
    if (result.Errors?.length) throw new Error("DOCUMENT_DELETE_FAILED");
  }
}
