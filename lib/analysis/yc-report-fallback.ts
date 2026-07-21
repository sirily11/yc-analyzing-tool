import type { ComparableResearchSource } from "@/lib/types/analysis";
import type { YcCompany, YcCompanyDatasetEvidence } from "@/lib/types/company";

export type YcDatasetResearchMaterial = {
  source: ComparableResearchSource;
  content: string;
};

function fallbackContent(company: YcCompany, evidence: YcCompanyDatasetEvidence) {
  return [
    "YC directory snapshot stored in Turso. This is dataset evidence, not live website research.",
    `Company: ${company.name}`,
    `One-line description: ${company.oneLiner}`,
    evidence.longDescription ? `Long description: ${evidence.longDescription}` : "",
    `Industry: ${company.industry}`,
    `Subindustry: ${company.subindustry}`,
    evidence.tags.length ? `Tags: ${evidence.tags.join(", ")}` : "",
    `Target market: ${company.targetMarket}`,
    `Location: ${company.location}`,
    `Operating area: ${company.operatingArea}`,
    `YC batch: ${company.batch}`,
    `Hiring: ${company.hiring ? "yes" : "no"}`,
    "Dataset limits: the stored record does not establish pricing or revenue model, traction metrics, or founder biographies. Do not infer those fields.",
  ].filter(Boolean).join("\n");
}

export function buildYcDatasetResearchFallback(input: {
  companies: YcCompany[];
  evidence: YcCompanyDatasetEvidence[];
  externalSources: ComparableResearchSource[];
  accessedAt?: string;
}) {
  const externallyCovered = new Set(input.externalSources.map((source) => source.companyId));
  const evidenceById = new Map(input.evidence.map((item) => [item.companyId, item]));
  const accessedAt = input.accessedAt ?? new Date().toISOString();
  const materials: YcDatasetResearchMaterial[] = [];

  for (const company of input.companies) {
    if (externallyCovered.has(company.id)) continue;
    const evidence = evidenceById.get(company.id);
    if (!evidence) continue;
    const source: ComparableResearchSource = {
      id: `yc-${company.id}`,
      companyId: company.id,
      title: `${company.name} — stored YC directory snapshot`,
      url: `https://www.ycombinator.com/companies/${encodeURIComponent(company.slug)}`,
      sourceType: "yc-profile",
      publishedAt: null,
      accessedAt,
    };
    materials.push({ source, content: fallbackContent(company, evidence) });
  }

  return {
    sources: materials.map((item) => item.source),
    materials,
  };
}
