import "server-only";
import { generateText, Output } from "ai";
import { appConfig } from "@/config";
import { generatedApplicationProfileSchema, type ApplicationProfile, type ExtractedPdf } from "@/lib/types/analysis";
import { gatewayProviderOptions, normalizeLanguageUsage, recordAiUsage, type MeteringContext } from "@/lib/billing/usage";

export async function categorizeApplication(document: ExtractedPdf, metering?: MeteringContext): Promise<ApplicationProfile> {
  const isChatBrief = document.metadata.kind === "chat";
  const pages = document.pages.map((page) => `\n--- PAGE ${page.page} ---\n${page.text}`).join("");
  const result = await generateText({
    model: appConfig.analysisModel,
    maxOutputTokens: 4_096,
    temperature: 0,
    output: Output.object({ schema: generatedApplicationProfileSchema }),
    system: `You extract a conservative startup application profile. Use only evidence in the supplied ${isChatBrief ? "founder chat brief" : "PDF"}. Mark missing information instead of inventing it. Evidence pages are page numbers, never quotes; use page 1 for a chat brief. Do not estimate YC acceptance probability.

Always write the profile in English, even when the source is in another language: translate every field — summary, sector, subindustry, targetCustomer, businessModel, productModality, geography, teamSizeBand, stage, tractionSignals, missingFields, and companyName if it is a translatable phrase — into natural English. Keep a proper company brand name as-is. The fit model is English-only, so a non-English field produces an incorrect score. Translating does not mean inventing: only translate what the source states.

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
