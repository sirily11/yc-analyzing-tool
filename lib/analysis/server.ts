import "server-only";
import { generateText, Output } from "ai";
import { appConfig, hasGatewayConfig } from "@/config";
import { applicationProfileSchema, type ApplicationProfile, type ExtractedPdf } from "@/lib/types/analysis";

const sectors: Array<[RegExp, string, string]> = [
  [/health|clinical|patient|medical|biotech|drug|therapeutic/i, "Healthcare", "Health & life sciences"],
  [/payment|bank|credit|finance|insurance|fintech/i, "Fintech", "Financial services"],
  [/robot|manufactur|factory|industrial|construction|hardware/i, "Industrials", "Industrial & physical economy"],
  [/consumer|social|marketplace|creator|game/i, "Consumer", "Consumers"],
  [/education|student|teacher|school|learn/i, "Education", "Education"],
  [/government|defense|public sector/i, "Government", "Public sector & defense"],
];

export async function categorizeApplication(document: ExtractedPdf): Promise<ApplicationProfile> {
  if (!hasGatewayConfig) return heuristicProfile(document);
  const isChatBrief = document.metadata.kind === "chat";
  const pages = document.pages.map((page) => `\n--- PAGE ${page.page} ---\n${page.text}`).join("");
  const { output } = await generateText({
    model: appConfig.analysisModel,
    temperature: 0,
    output: Output.object({ schema: applicationProfileSchema }),
    system: `You extract a conservative startup application profile. Use only evidence in the supplied ${isChatBrief ? "founder chat brief" : "PDF"}. Mark missing information instead of inventing it. Evidence pages are page numbers, never quotes; use page 1 for a chat brief. Do not estimate YC acceptance probability.`,
    prompt: `Analyze this ${isChatBrief ? "typed startup description" : "business plan"} and return the requested profile. Source: ${document.metadata.name}.${pages.slice(0, appConfig.pdf.maxCharacters)}`,
  });
  return output;
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
  };
}
