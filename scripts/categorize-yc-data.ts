import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { generateText, Output } from "ai";
import { z } from "zod";
import { appConfig } from "../config";
import type { YcCompany } from "../lib/types/company";

if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is required for offline categorization.");
const inputPath = path.join(process.cwd(), "public/data/yc-companies.json");
const outputPath = path.join(process.cwd(), "ml/data/processed/company-profiles.jsonl");
await mkdir(path.dirname(outputPath), { recursive: true });
const companies = JSON.parse(await readFile(inputPath, "utf8")) as YcCompany[];
const existingText = await readFile(outputPath, "utf8").catch(() => "");
const completed = new Set(existingText.split("\n").filter(Boolean).map((line) => JSON.parse(line).id as number));
const concurrency = Math.max(1, Math.min(12, Number(process.env.CATEGORIZATION_CONCURRENCY ?? 12)));

const schema = z.object({
  sector: z.string(), subindustry: z.string(), targetCustomer: z.string(), businessModel: z.string(), productModality: z.string(), geography: z.string(), aiLinked: z.boolean(), teamSizeBand: z.string(), stage: z.string(), tractionSignals: z.array(z.string()).max(5), missingFields: z.array(z.string()).max(10),
});

async function categorize(company: YcCompany) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const { output } = await generateText({
        model: appConfig.analysisModel,
        temperature: 0,
        output: Output.object({ schema }),
        system: "Categorize public startup directory text conservatively. Do not invent traction, team, or business-model facts. Mark missing values explicitly.",
        prompt: JSON.stringify({ name: company.name, oneLiner: company.oneLiner, industry: company.industry, subindustry: company.subindustry, targetMarket: company.targetMarket, geography: company.operatingArea }),
        providerOptions: { gateway: { tags: ["application-signal", "offline-categorization"] } },
      });
      return { id: company.id, ...output };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

const pending = companies.filter((company) => !completed.has(company.id));
console.log(`Categorizing ${pending.length.toLocaleString()} companies with concurrency ${concurrency}.`);
for (let offset = 0; offset < pending.length; offset += concurrency) {
  const batch = pending.slice(offset, offset + concurrency);
  const rows = await Promise.all(batch.map(categorize));
  await appendFile(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  for (const row of rows) completed.add(row.id);
  console.log(`${completed.size.toLocaleString()}/${companies.length.toLocaleString()} categorized`);
}
