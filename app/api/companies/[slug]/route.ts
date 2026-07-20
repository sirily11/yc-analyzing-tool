import { NextResponse } from "next/server";
import { fetchYcCompanyDetail } from "@/lib/yc/company-data";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    return NextResponse.json({ error: "Invalid company slug" }, { status: 400 });
  }

  try {
    return NextResponse.json(await fetchYcCompanyDetail(slug), {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("Unable to load YC company detail", { slug, error });
    return NextResponse.json({ error: "Company details are temporarily unavailable" }, { status: 502 });
  }
}
