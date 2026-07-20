import { z } from "zod";

export const companyClusterPointSchema = z.object({
  companyId: z.number().int(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  target: z.boolean(),
  textSource: z.enum(["firecrawl", "dataset"]),
});

export const companyClusterMapSchema = z.object({
  mode: z.enum(["semantic", "fallback-global"]),
  algorithm: z.literal("umap"),
  seed: z.number().int(),
  modelWeight: z.number().min(0).max(1),
  webWeight: z.number().min(0).max(1),
  embeddingModel: z.string().min(1),
  modelVersion: z.string().min(1),
  datasetVersion: z.string().min(1),
  warning: z.string().max(500).nullable(),
  points: z.array(companyClusterPointSchema).min(1).max(50),
});

export type CompanyClusterMap = z.infer<typeof companyClusterMapSchema>;
