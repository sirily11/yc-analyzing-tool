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

// Provider-facing structured output must require every property. Keep the
// defaulted schema above for reading profiles created before founder scoring.
export const generatedApplicationProfileSchema = applicationProfileSchema.extend({
  founderProfile: founderProfileSchema,
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

export const candidateEvidenceSchema = z.object({
  claim: z.string().min(1).max(500),
  sourceLabel: z.string().min(1).max(80),
  page: z.number().int().positive().nullable(),
});

export const comparableResearchSourceSchema = z.object({
  id: z.string().min(1).max(40),
  companyId: z.number().int(),
  title: z.string().min(1).max(240),
  url: z.string().url(),
  sourceType: z.enum(["yc-profile", "company-website", "founder-source", "related-coverage"]),
  publishedAt: z.string().nullable(),
  accessedAt: z.string().datetime(),
});

export type ComparableResearchSource = z.infer<typeof comparableResearchSourceSchema>;

export const comparisonMatrixRowSchema = z.object({
  companyId: z.number().int(),
  companyName: z.string().min(1).max(120),
  product: z.string().min(1).max(500),
  customer: z.string().min(1).max(500),
  businessModel: z.string().min(1).max(500),
  traction: z.string().min(1).max(500),
  founders: z.string().min(1).max(500),
  similarity: z.string().min(1).max(500),
  difference: z.string().min(1).max(500),
  lesson: z.string().min(1).max(600),
  sourceIds: z.array(z.string()).min(1).max(12),
});

export const comparableDeepDiveSchema = z.object({
  companyId: z.number().int(),
  companyName: z.string().min(1).max(120),
  overview: z.string().min(1).max(1_200),
  websiteAnalysis: z.string().min(1).max(1_200),
  founderAnalysis: z.string().min(1).max(1_200),
  tractionAnalysis: z.string().min(1).max(1_200),
  similarities: z.array(z.string().min(1).max(500)).min(1).max(5),
  differences: z.array(z.string().min(1).max(500)).min(1).max(5),
  lessons: z.array(z.string().min(1).max(600)).min(1).max(5),
  sourceIds: z.array(z.string()).min(1).max(16),
});

export const reportRiskSchema = z.object({
  title: z.string().min(1).max(160),
  detail: z.string().min(1).max(700),
  evidenceToAdd: z.string().min(1).max(500),
});

export const reportRecommendationSchema = z.object({
  priority: z.number().int().min(1).max(6),
  title: z.string().min(1).max(160),
  action: z.string().min(1).max(700),
  rationale: z.string().min(1).max(700),
  proofToAdd: z.string().min(1).max(500),
  suggestedFraming: z.string().min(1).max(700),
});

export const reportActionPlanItemSchema = z.object({
  period: z.enum(["Days 1–7", "Days 8–14", "Days 15–21", "Days 22–30"]),
  focus: z.string().min(1).max(160),
  actions: z.array(z.string().min(1).max(500)).min(1).max(5),
});

export const generatedReportDraftSchema = z.object({
  executiveNarrative: z.string().min(1).max(1_500),
  scoreInterpretation: z.string().min(1).max(1_200),
  candidateEvidence: z.array(candidateEvidenceSchema).min(1).max(12),
  diagnosis: z.object({
    marketCustomer: z.string().min(1).max(1_200),
    product: z.string().min(1).max(1_200),
    traction: z.string().min(1).max(1_200),
    founders: z.string().min(1).max(1_200),
    readiness: z.string().min(1).max(1_200),
  }),
  comparisonMatrix: z.array(comparisonMatrixRowSchema).max(5),
  companyDeepDives: z.array(comparableDeepDiveSchema).max(5),
  strengths: z.array(z.string().min(1).max(600)).min(1).max(6),
  risks: z.array(reportRiskSchema).min(1).max(6),
  recommendations: z.array(reportRecommendationSchema).min(1).max(6),
  actionPlan: z.array(reportActionPlanItemSchema).length(4),
});

export type GeneratedReportDraft = z.infer<typeof generatedReportDraftSchema>;

export const reportDossierSchema = generatedReportDraftSchema.extend({
  researchSources: z.array(comparableResearchSourceSchema).max(80),
  researchWarnings: z.array(z.string().min(1).max(500)).max(20),
});

export const reportGenerationSchema = z.object({
  draftModel: z.string().min(1),
  draftedAt: z.string().datetime(),
  researchStatus: z.enum(["complete", "partial", "unavailable"]),
  comparableCompanyLimit: z.number().int().min(0).max(12),
});

export const reportDocumentSchema = z.object({
  schemaVersion: z.literal(2).optional(),
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
  dossier: reportDossierSchema.optional(),
  generation: reportGenerationSchema.optional(),
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
