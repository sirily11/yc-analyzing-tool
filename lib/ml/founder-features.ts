import featureSpec from "@/lib/ml/founder-feature-spec.json";
import type { FounderProfile } from "@/lib/types/analysis";

type FeatureKey = keyof typeof featureSpec;

const orderedKeys: FeatureKey[] = [
  "founderCountBand",
  "capabilityDomains",
  "domainExperience",
  "technicalCapability",
  "priorBuildingExperience",
  "teamComplementarity",
];

export const founderFeatureDimensions = orderedKeys.reduce((sum, key) => sum + featureSpec[key].length, 0);

export function hasFounderEvidence(profile: FounderProfile | null | undefined) {
  if (!profile) return false;
  return profile.capabilityDomains.length > 0
    || profile.domainExperience !== "not-evidenced"
    || profile.technicalCapability !== "not-evidenced"
    || profile.priorBuildingExperience !== "not-evidenced"
    || profile.teamComplementarity === "demonstrated";
}

export function founderFeatureVector(profile: FounderProfile | null | undefined) {
  const values = new Float32Array(founderFeatureDimensions);
  if (!profile) return values;

  let offset = 0;
  for (const key of orderedKeys) {
    const options = featureSpec[key] as readonly string[];
    const selected = key === "capabilityDomains"
      ? new Set(profile.capabilityDomains)
      : new Set([profile[key] as string]);
    options.forEach((option, index) => {
      if (selected.has(option)) values[offset + index] = 1;
    });
    offset += options.length;
  }
  return values;
}

export { featureSpec as founderFeatureSpec };
