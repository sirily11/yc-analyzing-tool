import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/sqlite-core";

export const YC_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
export const YC_EMBEDDING_DIMENSIONS = 1536;

export function validateYcEmbedding(embedding: readonly number[]) {
  if (embedding.length !== YC_EMBEDDING_DIMENSIONS) {
    throw new Error(`YC_EMBEDDING_DIMENSIONS_MISMATCH:${embedding.length}`);
  }
  if (embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("YC_EMBEDDING_INVALID");
  }
  return embedding;
}

export const f32Vector = customType<{
  data: number[];
  config: { dimensions: number };
  configRequired: true;
  driverData: ArrayBuffer;
}>({
  dataType(config) {
    return `F32_BLOB(${config.dimensions})`;
  },
  fromDriver(value) {
    return Array.from(new Float32Array(value));
  },
  toDriver(value) {
    return sql`vector32(${JSON.stringify(value)})`;
  },
});
