import "server-only";
import { parseYcCompanyPage } from "@/lib/yc/company-detail";

export async function fetchYcCompanyDetail(slug: string, signal?: AbortSignal) {
  if (!/^[a-z0-9_-]+$/i.test(slug)) throw new Error("INVALID_COMPANY_SLUG");
  const response = await fetch(`https://www.ycombinator.com/companies/${encodeURIComponent(slug)}`, {
    headers: { Accept: "text/html" },
    next: { revalidate: 1800 },
    signal,
  });
  if (!response.ok) throw new Error(`YC_COMPANY_DETAIL_FAILED:${response.status}`);
  return parseYcCompanyPage(await response.text());
}
