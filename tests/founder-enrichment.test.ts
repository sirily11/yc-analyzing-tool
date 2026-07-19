import { describe, expect, it } from "vitest";
import { founderCountBand, founderEvidenceCoverage, missingFounderProfile } from "@/scripts/enrich-yc-founders";

describe("founder enrichment", () => {
  it("normalizes founder count without retaining founder identity", () => {
    expect(founderCountBand(1)).toBe("solo");
    expect(founderCountBand(2)).toBe("two");
    expect(founderCountBand(4)).toBe("three-plus");
    expect(missingFounderProfile(42, 1)).toEqual({
      id: 42,
      founderCountBand: "solo",
      capabilityDomains: [],
      domainExperience: "not-evidenced",
      technicalCapability: "not-evidenced",
      priorBuildingExperience: "not-evidenced",
      teamComplementarity: "not-applicable",
      evidencePages: [],
      missingFields: ["founder background"],
      coverage: 0,
    });
  });

  it("counts only substantive job-relevant signals as coverage", () => {
    expect(founderEvidenceCoverage({
      capabilityDomains: ["software"],
      domainExperience: "direct",
      technicalCapability: "demonstrated",
      priorBuildingExperience: "not-evidenced",
      teamComplementarity: "not-evidenced",
    })).toBe(0.6);
  });
});
