import { z } from "zod";

export const companyResearchSourceSchema = z.object({
  id: z.string().min(1).max(40),
  companyId: z.number().int(),
  kind: z.enum(["yc-profile", "official-site", "web-search"]),
  title: z.string().min(1).max(240),
  url: z.string().url(),
  retrievedAt: z.string().datetime(),
  status: z.enum(["ok", "failed"]),
  note: z.string().max(300).optional(),
});

export const citedInsightSchema = z.object({
  text: z.string().min(1).max(800),
  sourceIds: z.array(z.string().min(1).max(40)).min(1).max(8),
});

export const companyResearchProfileSchema = z.object({
  companyId: z.number().int(),
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(180),
  batch: z.string().min(1).max(80),
  industry: z.string().min(1).max(160),
  location: z.string().min(1).max(240),
  website: z.string().url().nullable(),
  overview: citedInsightSchema,
  product: citedInsightSchema,
  customers: citedInsightSchema,
  businessModel: citedInsightSchema,
  signals: z.array(citedInsightSchema).max(6),
  unknowns: z.array(z.string().min(1).max(400)).max(6),
  semanticText: z.string().min(1).max(4_000),
});

export const companyResearchComparisonSchema = z.object({
  sharedPatterns: z.array(citedInsightSchema).max(6),
  differentiators: z.array(citedInsightSchema).max(10),
  opportunities: z.array(citedInsightSchema).max(6),
  risks: z.array(citedInsightSchema).max(6),
});

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

export const companyResearchDraftSchema = z.object({
  kind: z.literal("company-research"),
  title: z.string().min(1).max(160),
  request: z.string().min(1).max(1_000),
  executiveSummary: z.string().min(1).max(2_000),
  companies: z.array(companyResearchProfileSchema).min(1).max(10),
  comparison: companyResearchComparisonSchema,
  sources: z.array(companyResearchSourceSchema).min(1).max(100),
  warnings: z.array(z.string().min(1).max(500)).max(50),
  methodology: z.string().min(1).max(1_500),
  generatedAt: z.string().datetime(),
});

export const companyResearchReportDocumentSchema = companyResearchDraftSchema.extend({
  map: companyClusterMapSchema,
});

export const companyResearchMapInputSchema = z.object({
  reportId: z.string().uuid(),
  targets: z.array(z.object({
    companyId: z.number().int(),
    semanticText: z.string().min(1).max(4_000),
    textSource: z.enum(["firecrawl", "dataset"]),
  })).min(1).max(10),
});

export type CompanyResearchSource = z.infer<typeof companyResearchSourceSchema>;
export type CompanyResearchDraft = z.infer<typeof companyResearchDraftSchema>;
export type CompanyResearchReportDocument = z.infer<typeof companyResearchReportDocumentSchema>;
export type CompanyResearchMapInput = z.infer<typeof companyResearchMapInputSchema>;
export type CompanyClusterMap = z.infer<typeof companyClusterMapSchema>;
