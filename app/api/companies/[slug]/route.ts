import { NextResponse } from "next/server";
import { parseYcCompanyPage } from "@/lib/yc/company-detail";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    return NextResponse.json({ error: "Invalid company slug" }, { status: 400 });
  }

  try {
    const response = await fetch(`https://www.ycombinator.com/companies/${encodeURIComponent(slug)}`, {
      headers: { Accept: "text/html" },
      next: { revalidate: 1800 },
    });
    if (!response.ok) throw new Error(`YC returned ${response.status}`);

    return NextResponse.json(parseYcCompanyPage(await response.text()), {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("Unable to load YC company detail", { slug, error });
    return NextResponse.json({ error: "Company details are temporarily unavailable" }, { status: 502 });
  }
}
