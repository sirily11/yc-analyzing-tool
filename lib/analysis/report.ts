import "server-only";
import { appConfig } from "@/config";
import type { ApplicationProfile, ComparableResearchSource, GeneratedReportDraft, PredictionResult, ReportDocument } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

const disclaimer = "Application Signal is independent and is not affiliated with Y Combinator. This fit score compares public company patterns; it is not an acceptance probability, admissions advice, or an investment recommendation.";

type ReportBuildOptions = {
  draft?: GeneratedReportDraft;
  researchSources?: ComparableResearchSource[];
  researchWarnings?: string[];
  researchStatus?: "complete" | "partial" | "unavailable";
  draftModel?: string;
};

function deterministicDraft(profile: ApplicationProfile, prediction: PredictionResult, companies: YcCompany[]): GeneratedReportDraft {
  const lookup = new Map(companies.map((company) => [company.id, company]));
  const nearest = prediction.nearestCompanyIds.slice(0, appConfig.reportResearch.comparableCompanyLimit).flatMap((id) => {
    const company = lookup.get(id);
    return company ? [company] : [];
  });
  const components = prediction.scoreComponents;
  const missing = [...new Set([...profile.missingFields, ...(components.founderFit === null ? profile.founderProfile.missingFields : [])])];
  return {
    title: `${profile.companyName} — ${profile.sector} for ${profile.targetCustomer}`.slice(0, 120),
    executiveNarrative: `The company is most credible where its ${profile.sector.toLowerCase()} positioning, target customer, and demonstrated execution reinforce one another. The next draft should replace broad claims with compact, verifiable evidence.`,
    scoreInterpretation: `The ${prediction.band.toLowerCase()} result reflects similarity to accepted-company patterns, with ${prediction.coverage} evidence coverage. It is a fit signal rather than an acceptance probability.`,
    candidateEvidence: [
      ...profile.tractionSignals.slice(0, 4).map((claim, index) => ({ claim, sourceLabel: profile.evidencePages[index] ? `Page ${profile.evidencePages[index]}` : "Application evidence", page: profile.evidencePages[index] ?? null })),
      ...missing.slice(0, 2).map((field) => ({ claim: `${field} is not yet supported by decision-grade evidence.`, sourceLabel: "Missing evidence", page: null })),
      ...(profile.tractionSignals.length === 0 && missing.length === 0
        ? [{ claim: profile.summary, sourceLabel: profile.evidencePages[0] ? `Page ${profile.evidencePages[0]}` : "Application evidence", page: profile.evidencePages[0] ?? null }]
        : []),
    ].slice(0, 6),
    diagnosis: {
      marketCustomer: `The stated customer is ${profile.targetCustomer}. The application should identify the buyer, urgent workflow, current workaround, and measurable cost of inaction.`,
      product: `${profile.productModality} in ${profile.subindustry}. Explain what users do before and after adopting it, and which part is difficult to reproduce.`,
      traction: profile.tractionSignals.join(" ") || "No concrete traction evidence was provided.",
      founders: components.founderFit === null ? "Founder evidence was insufficient for founder-aware scoring. Add concrete, job-relevant proof of domain access and building ability." : `The evidenced founder profile contributes ${Math.round(components.founderWeight * 100)}% of the fit score; make the causal founder advantage explicit.`,
      readiness: missing.length ? `The main readiness constraint is missing evidence for ${missing.join(", ")}.` : "Core fields are present; improve specificity, compression, and proof density.",
    },
    comparisonMatrix: nearest.map((company) => ({
      companyId: company.id,
      companyName: company.name,
      product: company.oneLiner,
      customer: company.targetMarket,
      businessModel: "Not established in the public dataset",
      traction: "Requires current public research",
      founders: "Requires current public research",
      similarity: `Model-selected neighbor in ${company.industry} / ${company.subindustry}.`,
      difference: `The public dataset does not establish how ${company.name}'s execution differs from this application.`,
      lesson: "Use the comparable as a positioning reference, not as evidence of likely acceptance.",
      sourceIds: [`yc-${company.id}`],
    })),
    companyDeepDives: nearest.map((company) => ({
      companyId: company.id,
      companyName: company.name,
      overview: company.oneLiner,
      websiteAnalysis: "External website research was unavailable for this draft.",
      founderAnalysis: "Public professional founder evidence was unavailable for this draft.",
      tractionAnalysis: "Current public traction evidence was unavailable for this draft.",
      similarities: [`Both occupy the broader ${company.industry} accepted-company space.`],
      differences: ["Detailed execution differences require verified public sources."],
      lessons: ["State the customer problem and differentiated execution more specifically than a directory one-liner."],
      sourceIds: [`yc-${company.id}`],
    })),
    strengths: [
      profile.aiLinked ? "The product has a clear AI or machine-learning linkage." : "The product is not dependent on an undifferentiated AI claim.",
      profile.targetCustomer !== "Not clearly specified" ? `The target customer is identifiable as ${profile.targetCustomer}.` : "The product can be evaluated against a defined customer cluster.",
      profile.tractionSignals[0] || "The application supplies an initial product thesis.",
    ],
    risks: (missing.length ? missing : ["specificity and compression"]).slice(0, 6).map((field) => ({
      title: `Insufficient evidence: ${field}`,
      detail: `A reviewer cannot yet make a fast, confident decision about ${field}.`,
      evidenceToAdd: `Add one recent, quantified, attributable proof point for ${field}.`,
    })),
    recommendations: [
      { priority: 1, title: "Lead with one sharp customer problem", action: `Name the exact ${profile.targetCustomer.toLowerCase()} user, painful workflow, and measurable consequence in the first two sentences.`, rationale: "Reviewers need to understand urgency before market breadth.", proofToAdd: "A customer quote, observed workflow, or quantified cost.", suggestedFraming: "[Specific user] loses [measurable outcome] because [current workflow]; we replace it with [product result]." },
      { priority: 2, title: "Replace claims with a proof point", action: "Add the strongest revenue, usage, retention, pilot, or speed-of-execution number.", rationale: "Verified behavior is more decision-dense than adjectives.", proofToAdd: "A dated metric with denominator and time period.", suggestedFraming: "In [period], [number] users/customers completed [behavior], producing [result]." },
      { priority: 3, title: "Make the founder advantage causal", action: "Explain the earned access, technical insight, or execution history that directly produced this company.", rationale: "Relevant evidence matters more than biography or prestige.", proofToAdd: "A concrete prior build, domain workflow, or distribution advantage.", suggestedFraming: "We learned [non-obvious insight] by [specific work], which lets us [advantage]." },
      { priority: 4, title: "Show why now", action: `Connect timing to one specific technology, regulation, cost curve, or behavior shift in ${profile.sector}.`, rationale: "A timing mechanism makes urgency testable.", proofToAdd: "A dated external or customer-side change.", suggestedFraming: "This became possible/necessary now because [change], reducing [constraint] from [before] to [now]." },
    ],
    actionPlan: [
      { period: "Days 1–7", focus: "Evidence audit", actions: ["List every application claim and attach a metric, source, or customer observation.", "Mark unsupported claims for removal or validation."] },
      { period: "Days 8–14", focus: "Customer proof", actions: ["Run focused customer conversations around the highest-risk workflow.", "Capture one measurable before-and-after result."] },
      { period: "Days 15–21", focus: "Application rewrite", actions: ["Rewrite the opening and traction answers around the strongest proof.", "Compress founder advantage into a causal, job-relevant explanation."] },
      { period: "Days 22–30", focus: "Stress test", actions: ["Have an uninvolved reader summarize the company after two minutes.", "Remove anything that does not change a reviewer decision."] },
    ],
  };
}

export function buildReportDocument(profile: ApplicationProfile, prediction: PredictionResult, companies: YcCompany[], options: ReportBuildOptions = {}): ReportDocument {
  const lookup = new Map(companies.map((company) => [company.id, company]));
  const comparableCompanies = prediction.nearestCompanyIds.slice(0, 6).flatMap((id, index) => {
    const company = lookup.get(id); if (!company) return [];
    return [{ id, name: company.name, oneLiner: company.oneLiner, similarity: Number(Math.max(0.5, 0.92 - index * 0.055).toFixed(2)) }];
  });
  const components = prediction.scoreComponents;
  const ycSources = comparableCompanies.slice(0, appConfig.reportResearch.comparableCompanyLimit).map((company) => ({
    id: `yc-${company.id}`,
    companyId: company.id,
    title: `${company.name} — YC company profile`,
    url: `https://www.ycombinator.com/companies/${encodeURIComponent(lookup.get(company.id)?.slug ?? "")}`,
    sourceType: "yc-profile" as const,
    publishedAt: null,
    accessedAt: new Date().toISOString(),
  }));
  const researchSources = [...(options.researchSources ?? []), ...ycSources.filter((source) => !(options.researchSources ?? []).some((existing) => existing.companyId === source.companyId && existing.sourceType === "yc-profile"))];
  const baseDraft = options.draft ?? deterministicDraft(profile, prediction, companies);
  const draft = options.draft ? baseDraft : {
    ...baseDraft,
    comparisonMatrix: baseDraft.comparisonMatrix.map((row) => ({ ...row, sourceIds: [researchSources.find((source) => source.companyId === row.companyId)?.id ?? `yc-${row.companyId}`] })),
    companyDeepDives: baseDraft.companyDeepDives.map((row) => ({ ...row, sourceIds: [researchSources.find((source) => source.companyId === row.companyId)?.id ?? `yc-${row.companyId}`] })),
  };
  return {
    schemaVersion: 2,
    title: draft.title,
    executiveSummary: `${profile.companyName} lands in the ${prediction.band.toLowerCase()} range at ${Math.round(prediction.score)}/100. ${draft.executiveNarrative}`,
    profile,
    prediction,
    comparableCompanies,
    strengths: draft.strengths,
    gaps: draft.risks.map((risk) => `${risk.title}: ${risk.detail}`),
    recommendations: draft.recommendations.map((item) => ({ priority: item.priority, title: item.title, detail: `${item.action} ${item.rationale}` })),
    methodology: `${components.founderFit === null
      ? "The score is the startup-fit percentile against a versioned 2022–2026 YTD public YC-company dataset. Founder evidence was unavailable, so it was not penalized or included. The model is not trained on rejected applications."
      : `The score blends ${Math.round(components.startupWeight * 100)}% startup fit and ${Math.round(components.founderWeight * 100)}% founder fit against a versioned 2022–2026 YTD public YC-company dataset. Founder inputs use controlled, job-relevant evidence rather than names, demographics, schools, employers, or prestige. The model is not trained on rejected applications.`} The five closest model-selected companies are researched separately from scoring. Their public sources explain execution patterns and suggestions but cannot change the locked score.`,
    disclaimer,
    dossier: {
      ...draft,
      researchSources,
      researchWarnings: options.researchWarnings ?? [],
    },
    generation: {
      draftModel: options.draftModel ?? appConfig.reportModel,
      draftedAt: new Date().toISOString(),
      researchStatus: options.researchStatus ?? "unavailable",
      comparableCompanyLimit: appConfig.reportResearch.comparableCompanyLimit,
    },
  };
}
