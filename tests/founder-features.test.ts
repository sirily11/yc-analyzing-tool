import { describe, expect, it } from "vitest";
import { founderFeatureDimensions, founderFeatureVector, hasFounderEvidence } from "@/lib/ml/founder-features";
import type { FounderProfile } from "@/lib/types/analysis";
import { applicationProfileSchema, predictionResultSchema } from "@/lib/types/analysis";

const profile = (overrides: Partial<FounderProfile> = {}): FounderProfile => ({
  founderCountBand: "two",
  capabilityDomains: [],
  domainExperience: "not-evidenced",
  technicalCapability: "not-evidenced",
  priorBuildingExperience: "not-evidenced",
  teamComplementarity: "unknown",
  evidencePages: [],
  missingFields: ["founder background"],
  coverage: 0,
  ...overrides,
});

describe("founder feature contract", () => {
  it("uses the shared fixed-width one-hot vocabulary", () => {
    const values = founderFeatureVector(profile({
      capabilityDomains: ["software", "ai-data"],
      domainExperience: "direct",
      technicalCapability: "demonstrated",
      priorBuildingExperience: "stated",
      teamComplementarity: "demonstrated",
      coverage: 1,
    }));
    expect(values).toHaveLength(founderFeatureDimensions);
    expect(Array.from(values).filter((value) => value === 1)).toHaveLength(7);
  });

  it("does not treat founder count or identity-only information as evidence", () => {
    expect(hasFounderEvidence(profile({ founderCountBand: "three-plus" }))).toBe(false);
    expect(hasFounderEvidence(profile({ capabilityDomains: ["hardware"] }))).toBe(true);
  });

  it("returns an all-zero vector for a legacy profile without founder data", () => {
    expect(Array.from(founderFeatureVector(undefined)).every((value) => value === 0)).toBe(true);
  });

  it("defaults legacy stored tool payloads without making founder absence a penalty", () => {
    const legacyProfile = applicationProfileSchema.parse({
      companyName: "Legacy",
      summary: "A legacy application profile",
      sector: "B2B",
      subindustry: "Software",
      targetCustomer: "Business teams",
      businessModel: "SaaS",
      productModality: "Software",
      geography: "Remote",
      aiLinked: false,
      teamSizeBand: "Unknown",
      stage: "Early",
      tractionSignals: [],
      missingFields: [],
      evidencePages: [1],
      extractionCoverage: 0.7,
    });
    expect(hasFounderEvidence(legacyProfile.founderProfile)).toBe(false);

    const legacyPrediction = predictionResultSchema.parse({
      scoreKind: "fit",
      score: 64,
      band: "Promising",
      coverage: "medium",
      reconstructionPercentile: 0.64,
      nearestCompanyIds: [],
      clusterPoint: { x: 0.5, y: 0.5 },
      factors: [],
      warnings: [],
      modelVersion: "browser-fit-v1",
      datasetVersion: "dataset-v1",
    });
    expect(legacyPrediction.scoreComponents).toEqual({ startupFit: 0, founderFit: null, startupWeight: 1, founderWeight: 0 });
  });
});
