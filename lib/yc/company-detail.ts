import type { YcCompanyDetail, YcFounder } from "@/lib/types/company";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeUrl(value: unknown) {
  const url = stringValue(value);
  return /^https:\/\//i.test(url) ? url : null;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseFounder(value: unknown): YcFounder | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.full_name);
  if (!name) return null;
  return {
    id: nullableNumber(value.user_id) ?? 0,
    name,
    title: stringValue(value.title) || "Founder",
    bio: stringValue(value.founder_bio),
    linkedIn: safeUrl(value.linkedin_url),
    twitter: safeUrl(value.twitter_url),
  };
}

export function parseYcCompanyPage(html: string): YcCompanyDetail {
  const dataPage = html.match(/\sdata-page="([^"]+)"/)?.[1];
  if (!dataPage) throw new Error("YC company payload was not found");

  const page = JSON.parse(decodeHtmlAttribute(dataPage)) as unknown;
  if (!isRecord(page) || !isRecord(page.props) || !isRecord(page.props.company)) {
    throw new Error("YC company payload has an unexpected shape");
  }

  const company = page.props.company;
  const founders = Array.isArray(company.founders)
    ? company.founders.map(parseFounder).filter((founder): founder is YcFounder => Boolean(founder))
    : [];

  return {
    longDescription: stringValue(company.long_description),
    yearFounded: nullableNumber(company.year_founded),
    teamSize: nullableNumber(company.team_size),
    status: stringValue(company.ycdc_status) || "Not listed",
    tags: Array.isArray(company.tags) ? company.tags.map(stringValue).filter(Boolean) : [],
    founders,
  };
}
