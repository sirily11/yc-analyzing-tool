import { z } from "zod";

export const founderCountBandSchema = z.enum(["solo", "two", "three-plus", "unknown"]);
export const founderCapabilityDomainSchema = z.enum([
  "software",
  "ai-data",
  "hardware",
  "science-health",
  "product-design",
  "sales-distribution",
  "operations",
  "finance-regulatory",
]);
export const founderExperienceSchema = z.enum(["direct", "adjacent", "not-evidenced"]);
export const founderEvidenceStrengthSchema = z.enum(["demonstrated", "stated", "not-evidenced"]);
export const founderTeamComplementaritySchema = z.enum(["demonstrated", "not-evidenced", "not-applicable", "unknown"]);

export const founderProfileSchema = z.object({
  founderCountBand: founderCountBandSchema,
  capabilityDomains: z.array(founderCapabilityDomainSchema).max(8),
  domainExperience: founderExperienceSchema,
  technicalCapability: founderEvidenceStrengthSchema,
  priorBuildingExperience: founderEvidenceStrengthSchema,
  teamComplementarity: founderTeamComplementaritySchema,
  evidencePages: z.array(z.number().int().positive()).max(20),
  missingFields: z.array(z.string()).max(8),
  coverage: z.number().min(0).max(1),
});

export type FounderProfile = z.infer<typeof founderProfileSchema>;

export const emptyFounderProfile: FounderProfile = {
  founderCountBand: "unknown",
  capabilityDomains: [],
  domainExperience: "not-evidenced",
  technicalCapability: "not-evidenced",
  priorBuildingExperience: "not-evidenced",
  teamComplementarity: "unknown",
  evidencePages: [],
  missingFields: ["founder background"],
  coverage: 0,
};

export const applicationProfileSchema = z.object({
  companyName: z.string().min(1),
  summary: z.string().min(1),
  sector: z.string().min(1),
  subindustry: z.string().min(1),
  targetCustomer: z.string().min(1),
  businessModel: z.string().min(1),
  productModality: z.string().min(1),
  geography: z.string().min(1),
  aiLinked: z.boolean(),
  teamSizeBand: z.string().min(1),
  stage: z.string().min(1),
  tractionSignals: z.array(z.string()).max(8),
  missingFields: z.array(z.string()).max(12),
  evidencePages: z.array(z.number().int().positive()).max(20),
  extractionCoverage: z.number().min(0).max(1),
  founderProfile: founderProfileSchema.default(emptyFounderProfile),
});

export type ApplicationProfile = z.infer<typeof applicationProfileSchema>;

export const predictionResultSchema = z.object({
  scoreKind: z.enum(["fit", "probability"]),
  score: z.number().min(0).max(100),
  band: z.enum(["Early signal", "Promising", "Strong fit"]),
  coverage: z.enum(["low", "medium", "high"]),
  reconstructionPercentile: z.number().min(0).max(1),
  scoreComponents: z.object({
    startupFit: z.number().min(0).max(100),
    founderFit: z.number().min(0).max(100).nullable(),
    startupWeight: z.number().min(0).max(1),
    founderWeight: z.number().min(0).max(1),
  }).default({ startupFit: 0, founderFit: null, startupWeight: 1, founderWeight: 0 }),
  nearestCompanyIds: z.array(z.number().int()).max(12),
  clusterPoint: z.object({ x: z.number(), y: z.number() }),
  factors: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      impact: z.enum(["positive", "neutral", "negative"]),
    }),
  ),
  warnings: z.array(z.string()),
  modelVersion: z.string(),
  datasetVersion: z.string(),
});

export type PredictionResult = z.infer<typeof predictionResultSchema>;

export const reportDocumentSchema = z.object({
  title: z.string().min(1),
  executiveSummary: z.string().min(1),
  profile: applicationProfileSchema,
  prediction: predictionResultSchema,
  comparableCompanies: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      oneLiner: z.string(),
      similarity: z.number().min(0).max(1),
    }),
  ).max(6),
  strengths: z.array(z.string()).min(1).max(6),
  gaps: z.array(z.string()).min(1).max(6),
  recommendations: z.array(
    z.object({
      priority: z.number().int().min(1).max(5),
      title: z.string(),
      detail: z.string(),
    }),
  ).min(1).max(5),
  methodology: z.string(),
  disclaimer: z.string(),
});

export type ReportDocument = z.infer<typeof reportDocumentSchema>;

export const sourceFileMetadataSchema = z.object({
  kind: z.enum(["pdf", "chat"]).optional(),
  name: z.string().min(1),
  size: z.number().int().positive(),
  pages: z.number().int().positive(),
  characters: z.number().int().positive(),
  sha256: z.string().length(64),
});

export type SourceFileMetadata = z.infer<typeof sourceFileMetadataSchema>;

export const extractedPdfSchema = z.object({
  metadata: sourceFileMetadataSchema,
  pages: z.array(z.object({ page: z.number().int().positive(), text: z.string() })).min(1),
  text: z.string().min(1),
});

export type ExtractedPdf = z.infer<typeof extractedPdfSchema>;
