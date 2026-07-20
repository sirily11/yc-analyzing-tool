import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { batchScrapeFirecrawl, FirecrawlScrapeError, mapFirecrawl, searchFirecrawl, selectOfficialPages } from "@/lib/firecrawl/client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FIRECRAWL_API_KEY;
});

describe("Firecrawl client", () => {
  it("selects only same-origin high-value official pages", () => {
    expect(selectOfficialPages("https://example.com", [
      { url: "https://example.com/blog/post" },
      { url: "https://example.com/about" },
      { url: "https://example.com/product" },
      { url: "https://evil.example.net/product" },
      { url: "http://127.0.0.1/internal" },
    ])).toEqual(["https://example.com/", "https://example.com/product", "https://example.com/about"]);
  });

  it("keeps credentials server-side and retries one 429 response", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { web: [{ title: "Acme", description: "Public result", url: "https://example.com/acme" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchFirecrawl("Acme")).resolves.toEqual([{ title: "Acme", description: "Public result", url: "https://example.com/acme" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1];
    expect(init.headers.Authorization).toBe("Bearer fc-secret");
    expect(String(init.body)).not.toContain("fc-secret");
    expect(JSON.parse(String(init.body))).toMatchObject({ limit: 3, sources: ["web"] });
  });

  it("maps official pages and verifies a bounded two-day-cached batch has no scrape errors", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, links: [{ url: "https://example.com/product", title: "Product" }] }))
      .mockResolvedValueOnce(Response.json({ success: true, id: "batch-1" }))
      .mockResolvedValueOnce(Response.json({ status: "completed", data: [
        { markdown: "# Product\nUseful details", metadata: { sourceURL: "https://example.com/product", title: "Product" } },
        { markdown: "# About\nCompany details", metadata: { sourceURL: "https://example.com/about", title: "About" } },
      ] }))
      .mockResolvedValueOnce(Response.json({ errors: [], robotsBlocked: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(mapFirecrawl("https://example.com")).resolves.toEqual([{ url: "https://example.com/product", title: "Product" }]);
    await expect(batchScrapeFirecrawl(["https://example.com/product", "https://example.com/about"])).resolves.toEqual([
      { url: "https://example.com/product", title: "Product", markdown: "# Product\nUseful details" },
      { url: "https://example.com/about", title: "About", markdown: "# About\nCompany details" },
    ]);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.firecrawl.dev/v2/map",
      "https://api.firecrawl.dev/v2/batch/scrape",
      "https://api.firecrawl.dev/v2/batch/scrape/batch-1",
      "https://api.firecrawl.dev/v2/batch/scrape/batch-1/errors",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ maxConcurrency: 4, maxAge: 172_800_000, formats: ["markdown"] });
  });

  it("returns every per-URL batch scrape failure instead of accepting partial results", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, id: "batch-2", invalidURLs: [] }))
      .mockResolvedValueOnce(Response.json({ status: "completed", data: [
        { markdown: "# Product", metadata: { sourceURL: "https://example.com/product", title: "Product" } },
      ] }))
      .mockResolvedValueOnce(Response.json({
        errors: [{ id: "error-1", timestamp: "Invalid Date", url: "https://example.com/about", error: "ERR_CONNECTION_CLOSED" }],
        robotsBlocked: ["https://example.com/pricing"],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const failure = await batchScrapeFirecrawl([
      "https://example.com/product",
      "https://example.com/about",
      "https://example.com/pricing",
    ]).catch((cause) => cause);

    expect(failure).toBeInstanceOf(FirecrawlScrapeError);
    expect(failure.failures).toEqual([
      { url: "https://example.com/about", message: "ERR_CONNECTION_CLOSED" },
      { url: "https://example.com/pricing", message: "Scraping was blocked by robots.txt." },
    ]);
  });
});
