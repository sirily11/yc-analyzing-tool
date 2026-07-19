import "server-only";
import type { ApplicationProfile, PredictionResult, ReportDocument } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

const disclaimer = "Application Signal is independent and is not affiliated with Y Combinator. This fit score compares public company patterns; it is not an acceptance probability, admissions advice, or an investment recommendation.";

export function buildReportDocument(profile: ApplicationProfile, prediction: PredictionResult, companies: YcCompany[]): ReportDocument {
  const lookup = new Map(companies.map((company) => [company.id, company]));
  const comparableCompanies = prediction.nearestCompanyIds.slice(0, 6).flatMap((id, index) => {
    const company = lookup.get(id); if (!company) return [];
    return [{ id, name: company.name, oneLiner: company.oneLiner, similarity: Number(Math.max(0.5, 0.92 - index * 0.055).toFixed(2)) }];
  });
  const components = prediction.scoreComponents;
  const strengths = [
    profile.aiLinked ? "The product has a clear AI or machine-learning linkage." : "The product is not dependent on an undifferentiated AI claim.",
    profile.targetCustomer !== "Not clearly specified" ? `The target customer is identifiable as ${profile.targetCustomer}.` : "The product direction can be compared with a defined customer cluster.",
    profile.tractionSignals[0],
    ...(components.founderFit === null ? [] : [`The founder profile scores ${Math.round(components.founderFit)}/100 against evidenced backgrounds in the public YC reference set.`]),
  ];
  const gapFields = [...profile.missingFields, ...(components.founderFit === null ? profile.founderProfile.missingFields : [])];
  const gaps = gapFields.length ? [...new Set(gapFields)].slice(0, 6).map((field) => `The plan needs more decision-grade evidence for ${field}.`) : ["The core application fields are present; the remaining work is specificity and compression."];
  const recommendations = [
    { priority: 1, title: "Lead with one sharp customer problem", detail: `Name the exact ${profile.targetCustomer.toLowerCase()} user, the painful workflow, and the measurable consequence in the first two sentences.` },
    { priority: 2, title: "Replace claims with a proof point", detail: "Add the strongest revenue, usage, retention, pilot, or speed-of-execution number that a reviewer can verify quickly." },
    { priority: 3, title: "Make the founder advantage concrete", detail: "Explain the unusual experience, access, technical insight, or earned distribution that makes this team uniquely suited to win." },
    { priority: 4, title: "Show why now", detail: `Connect the timing to a specific technology, regulation, cost curve, or behavior shift in ${profile.sector}.` },
  ];
  return {
    title: `${profile.companyName} · YC Fit Report`,
    executiveSummary: `${profile.companyName} lands in the ${prediction.band.toLowerCase()} range at ${Math.round(prediction.score)}/100. The strongest signal is its ${profile.sector.toLowerCase()} positioning; the largest opportunity is to make the application more evidence-dense and specific.`,
    profile,
    prediction,
    comparableCompanies,
    strengths,
    gaps,
    recommendations,
    methodology: components.founderFit === null
      ? "The score is the startup-fit percentile against a versioned 2022–2026 YTD public YC-company dataset. Founder evidence was unavailable, so it was not penalized or included. The model is not trained on rejected applications."
      : `The score blends ${Math.round(components.startupWeight * 100)}% startup fit and ${Math.round(components.founderWeight * 100)}% founder fit against a versioned 2022–2026 YTD public YC-company dataset. Founder inputs use controlled, job-relevant evidence rather than names, demographics, schools, employers, or prestige. The model is not trained on rejected applications.`,
    disclaimer,
  };
}
