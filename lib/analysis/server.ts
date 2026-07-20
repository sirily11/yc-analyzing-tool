import "server-only";
import { generateText, Output } from "ai";
import { appConfig, hasGatewayConfig } from "@/config";
import { generatedApplicationProfileSchema, type ApplicationProfile, type ExtractedPdf } from "@/lib/types/analysis";
import { gatewayProviderOptions, normalizeLanguageUsage, recordAiUsage, type MeteringContext } from "@/lib/billing/usage";

const sectors: Array<[RegExp, string, string]> = [
  [/health|clinical|patient|medical|biotech|drug|therapeutic/i, "Healthcare", "Health & life sciences"],
  [/payment|bank|credit|finance|insurance|fintech/i, "Fintech", "Financial services"],
  [/robot|manufactur|factory|industrial|construction|hardware/i, "Industrials", "Industrial & physical economy"],
  [/consumer|social|marketplace|creator|game/i, "Consumer", "Consumers"],
  [/education|student|teacher|school|learn/i, "Education", "Education"],
  [/government|defense|public sector/i, "Government", "Public sector & defense"],
];

export async function categorizeApplication(document: ExtractedPdf, metering?: MeteringContext): Promise<ApplicationProfile> {
  if (!hasGatewayConfig) return heuristicProfile(document);
  const isChatBrief = document.metadata.kind === "chat";
  const pages = document.pages.map((page) => `\n--- PAGE ${page.page} ---\n${page.text}`).join("");
  const result = await generateText({
    model: appConfig.analysisModel,
    maxOutputTokens: 4_096,
    temperature: 0,
    output: Output.object({ schema: generatedApplicationProfileSchema }),
    system: `You extract a conservative startup application profile. Use only evidence in the supplied ${isChatBrief ? "founder chat brief" : "PDF"}. Mark missing information instead of inventing it. Evidence pages are page numbers, never quotes; use page 1 for a chat brief. Do not estimate YC acceptance probability.

For founderProfile, record only job-relevant evidence: capability domains, experience relevant to this company's market, demonstrated or stated technical ability, prior building experience, and team complementarity. Never use or repeat founder names, age, gender, ethnicity, nationality, named schools, named employers, or prestige. "Demonstrated" requires a concrete accomplishment in the source; a self-description without proof is only "stated". If the source does not establish a signal, use "not-evidenced" rather than guessing. Founder count alone is not substantive founder evidence.`,
    prompt: `Analyze this ${isChatBrief ? "typed startup description" : "business plan"} and return the requested profile. Source: ${document.metadata.name}.${pages.slice(0, appConfig.pdf.maxCharacters)}`,
    ...(metering ? { providerOptions: gatewayProviderOptions(metering) } : {}),
  });
  if (metering) await recordAiUsage({
    context: metering,
    model: appConfig.analysisModel,
    responseId: result.response.id,
    providerMetadata: result.providerMetadata,
    usage: normalizeLanguageUsage(result.usage),
  });
  return result.output;
}

export function heuristicProfile(document: ExtractedPdf): ApplicationProfile {
  const text = document.text;
  const lower = text.toLowerCase();
  const sectorMatch = sectors.find(([pattern]) => pattern.test(text));
  const hasTraction = /\b(revenue|arr|mrr|customers?|users?|pilot|growth|retention|contracts?)\b/i.test(text);
  const hasTeam = /\b(founder|co-founder|team|engineer|scientist|designer)\b/i.test(text);
  const hasMarket = /\b(market|tam|sam|industry|billion|million)\b/i.test(text);
  const hasBusinessModel = /\b(subscription|saas|license|commission|transaction|usage-based|per seat|enterprise plan)\b/i.test(text);
  const firstLine = document.pages.flatMap((page) => page.text.split("\n")).map((line) => line.trim()).find((line) => line.length > 2 && line.length < 80);
  const companyName = firstLine?.replace(/business plan|pitch deck|confidential/gi, "").trim() || document.metadata.name.replace(/\.pdf$/i, "");
  const missingFields = [
    !hasTraction && "traction",
    !hasTeam && "founder-market fit",
    !hasMarket && "market sizing",
    !hasBusinessModel && "business model",
  ].filter(Boolean) as string[];
  const evidencePages = document.pages.filter((page) => /customer|market|product|team|revenue|problem/i.test(page.text)).slice(0, 10).map((page) => page.page);
  const summarySource = text.replace(/\s+/g, " ").trim().slice(0, 360);
  const founderPages = document.pages.filter((page) => /founder|co-founder|team|engineer|developer|scientist|research|built|launched|previously founded/i.test(page.text)).slice(0, 10).map((page) => page.page);
  const capabilityDomains = [
    /engineer|developer|software|program|code/i.test(text) && "software",
    /machine learning|\bai\b|data scientist|data engineer|llm/i.test(text) && "ai-data",
    /hardware|robot|electrical|mechanical|manufactur/i.test(text) && "hardware",
    /clinical|medical|doctor|physician|biolog|chemist|scientist|research/i.test(text) && "science-health",
    /product manager|product design|designer|ux|ui/i.test(text) && "product-design",
    /sales|marketing|distribution|growth|go-to-market|\bgtm\b/i.test(text) && "sales-distribution",
    /operations|supply chain|logistics/i.test(text) && "operations",
    /finance|bank|regulatory|compliance|legal/i.test(text) && "finance-regulatory",
  ].filter(Boolean) as ApplicationProfile["founderProfile"]["capabilityDomains"];
  const directDomainEvidence = /(?:worked|experience|background|research|practiced|operated).{0,80}(?:industry|sector|customer|market|clinical|finance|hardware|software)/i.test(text);
  const demonstratedTechnical = /(?:built|coded|programmed|engineered|designed|invented|published|shipped|launched)\b/i.test(text);
  const statedTechnical = /\b(?:engineer|developer|scientist|researcher|technical founder|designer)\b/i.test(text);
  const priorBuilding = /\b(?:previously|formerly|before this).{0,80}(?:founded|built|launched|shipped|started)\b/i.test(text);
  const soloFounder = /\bsolo founder\b/i.test(text);
  const cofounderTeam = /\bco[- ]?founders?\b|\bfounding team\b/i.test(text);
  const founderCountBand = soloFounder ? "solo" : cofounderTeam ? "two" : "unknown";
  const teamComplementarity = soloFounder ? "not-applicable" : cofounderTeam && capabilityDomains.length >= 2 ? "demonstrated" : cofounderTeam ? "not-evidenced" : "unknown";
  const founderSignals = [capabilityDomains.length > 0, directDomainEvidence, demonstratedTechnical || statedTechnical, priorBuilding, teamComplementarity === "demonstrated"].filter(Boolean).length;
  return {
    companyName: companyName.slice(0, 80),
    summary: summarySource || "The document did not contain enough selectable text for a reliable summary.",
    sector: sectorMatch?.[1] ?? "B2B",
    subindustry: sectorMatch?.[1] ?? "Software",
    targetCustomer: sectorMatch?.[2] ?? (/developer|api|software team|engineer/i.test(lower) ? "Developers & IT" : "Business teams"),
    businessModel: hasBusinessModel ? "Recurring or usage-based revenue" : "Not clearly specified",
    productModality: /hardware|device|robot|sensor/i.test(lower) ? "Hardware-enabled product" : /marketplace/i.test(lower) ? "Marketplace" : "Software product",
    geography: /san francisco|bay area/i.test(lower) ? "SF Bay Area" : /united states|usa/i.test(lower) ? "United States" : "Not clearly specified",
    aiLinked: /\b(ai|artificial intelligence|machine learning|llm|agent)\b/i.test(lower),
    teamSizeBand: hasTeam ? "Founding team described" : "Not clearly specified",
    stage: hasTraction ? "Early traction" : "Pre-traction or unclear",
    tractionSignals: [hasTraction ? "The plan includes at least one traction or customer signal." : "No concrete traction signal was detected."],
    missingFields,
    evidencePages: evidencePages.length ? evidencePages : [1],
    extractionCoverage: Math.max(0.35, Math.min(0.95, 1 - missingFields.length * 0.12)),
    founderProfile: {
      founderCountBand,
      capabilityDomains,
      domainExperience: directDomainEvidence ? "direct" : capabilityDomains.length ? "adjacent" : "not-evidenced",
      technicalCapability: demonstratedTechnical ? "demonstrated" : statedTechnical ? "stated" : "not-evidenced",
      priorBuildingExperience: priorBuilding ? "demonstrated" : "not-evidenced",
      teamComplementarity,
      evidencePages: founderPages,
      missingFields: founderSignals ? [] : ["founder background"],
      coverage: founderSignals / 5,
    },
  };
}
