import { Output } from "ai";
import { describe, expect, it } from "vitest";
import { applicationProfileSchema, generatedApplicationProfileSchema } from "@/lib/types/analysis";

describe("analysis structured-output schema", () => {
  it("requires founderProfile in the provider JSON Schema", async () => {
    const format = await Output.object({ schema: generatedApplicationProfileSchema }).responseFormat;

    if (!format || format.type !== "json" || !format.schema) throw new Error("Expected a JSON response format");
    expect(format.schema.required).toContain("founderProfile");
  });

  it("still defaults founder data when reading legacy stored profiles", () => {
    const legacy = applicationProfileSchema.parse({
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

    expect(legacy.founderProfile.coverage).toBe(0);
  });
});
