import { ZodError } from "zod";
import {
  loadYcCompanies,
  loadYcDatasetManifest,
  searchYcCompanies,
} from "@/lib/yc/companies";
import { consumeYcSemanticSearchLimit } from "@/lib/yc/search-rate-limit";

export const dynamic = "force-dynamic";

const cacheControl = "public, max-age=60, stale-while-revalidate=300";

class InvalidDirectoryRequestError extends Error {}

function values(searchParams: URLSearchParams, key: string) {
  return searchParams.getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function years(searchParams: URLSearchParams) {
  const currentYear = new Date().getUTCFullYear();
  return values(searchParams, "year").map((value) => {
    if (!/^\d{4}$/.test(value)) throw new InvalidDirectoryRequestError("Invalid year");
    const year = Number(value);
    if (year < 2020 || year > currentYear) throw new InvalidDirectoryRequestError("Invalid year");
    return year;
  });
}

function filters(searchParams: URLSearchParams) {
  const selectedYears = years(searchParams);
  const industries = values(searchParams, "industry");
  const targetMarkets = values(searchParams, "targetMarket");
  const operatingAreas = values(searchParams, "operatingArea");
  return {
    years: selectedYears.length ? selectedYears : undefined,
    industries: industries.length ? industries : undefined,
    targetMarkets: targetMarkets.length ? targetMarkets : undefined,
    operatingAreas: operatingAreas.length ? operatingAreas : undefined,
  };
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("query")?.trim() ?? "";
    if (query.length > 500) throw new InvalidDirectoryRequestError("Query is too long");
    const selectedFilters = filters(searchParams);
    if (query) {
      const rateLimit = await consumeYcSemanticSearchLimit(request);
      if (!rateLimit.allowed) {
        return Response.json(
          { error: "Too many semantic searches; try again shortly" },
          {
            status: 429,
            headers: {
              "Cache-Control": "private, no-store",
              "Retry-After": String(rateLimit.retryAfterSeconds),
            },
          },
        );
      }
    }
    const [result, manifest] = await Promise.all([
      query
        ? searchYcCompanies({ query, ...selectedFilters, limit: 50 })
        : loadYcCompanies(selectedFilters).then((companies) => ({ companies, total: companies.length })),
      loadYcDatasetManifest(),
    ]);
    return Response.json(
      { companies: result.companies, total: result.total, manifest },
      { headers: { "Cache-Control": cacheControl } },
    );
  } catch (error) {
    if (error instanceof InvalidDirectoryRequestError || error instanceof ZodError) {
      return Response.json(
        { error: error instanceof InvalidDirectoryRequestError ? error.message : "Invalid YC company directory filters" },
        { status: 400 },
      );
    }
    console.error("YC company directory request failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "YC company directory is unavailable" }, { status: 500 });
  }
}
